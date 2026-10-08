// SPDX-License-Identifier: MIT
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  privateKeyToAccount,
  mainnet,
  loadEvidence,
  validateEvidence,
  signerMode,
  zeroHash,
} from "./runtime.mjs";
import { attempt, floorBounty, auctionBounty, loanAction } from "./core.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(
  await readFile(
    process.argv[2] ?? resolve(root, "keeper/config.json"),
    "utf8",
  ),
);
const dryRun = process.env.DRY_RUN !== "false",
  alwaysRun = process.env.ALWAYS_RUN === "true";
// No key is read from files, command-line arguments, JSON config or alerts.
const key = process.env.KEEPER_PRIVATE_KEY;
if (!key && !dryRun)
  throw Error(
    "Set KEEPER_PRIVATE_KEY in the operator environment for live writes.",
  );
// Dry runs use eth_call from the shop owner, discovered below, without creating a signing key.
const client = createPublicClient({
  chain: mainnet,
  transport: http(process.env.RPC_URL || config.rpcUrl, {
    timeout: 20000,
    retryCount: 2,
  }),
});
if ((await client.getChainId()) !== 1)
  throw Error("RPC must be Ethereum mainnet.");
const contracts = {};
for (const name of ["PawnShop", "MilestoneBurn", "LaunchToken"]) {
  const address = getAddress(config.addresses[name]);
  const code = await client.getCode({ address });
  if (!code || code === "0x") throw Error(`No code for ${name}.`);
  contracts[name] = {
    address,
    abi: JSON.parse(
      await readFile(resolve(root, `docs/abi/${name}.json`), "utf8"),
    ),
  };
}
const shop = contracts.PawnShop,
  burn = contracts.MilestoneBurn,
  token = contracts.LaunchToken;
const read = (c, fn, args = []) =>
  client.readContract({
    address: c.address,
    abi: c.abi,
    functionName: fn,
    args,
  });
if (
  (await read(shop, "pawnToken")).toLowerCase() !==
    token.address.toLowerCase() ||
  (await read(burn, "pawnShop")).toLowerCase() !== shop.address.toLowerCase() ||
  (await read(burn, "pawnToken")).toLowerCase() !== token.address.toLowerCase()
)
  throw Error("Contract bindings mismatch.");
if (key && !/^0x[0-9a-f]{64}$/i.test(key))
  throw Error(
    "KEEPER_PRIVATE_KEY must be a 32-byte hex key supplied through the environment.",
  );
let signingAccount;
try {
  if (key) signingAccount = privateKeyToAccount(key);
} catch {
  throw Error("Invalid keeper signing key.");
}
const account = signingAccount ?? { address: await read(shop, "owner") };
const wallet = key
  ? createWalletClient({
      account,
      chain: mainnet,
      transport: http(process.env.RPC_URL || config.rpcUrl),
    })
  : { account };
let state = { cursor: "1" };
try {
  state = { ...state, ...JSON.parse(await readFile(config.stateFile, "utf8")) };
} catch {}
async function alert(message) {
  console.log(message);
  // Alert destinations and tokens exist only in the operator environment.
  try {
    if (process.env.WEBHOOK_URL) {
      const result = await fetch(process.env.WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message }),
        signal: AbortSignal.timeout(10000),
      });
      if (!result.ok) console.warn("Webhook delivery failed.");
    }
    if (process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      const result = await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: message,
          }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!result.ok) console.warn("Telegram delivery failed.");
    }
  } catch {
    console.warn("Alert delivery failed; inspect operator connectivity.");
  }
}
let failed = false;
async function isolated(label, fn) {
  try {
    await fn();
  } catch {
    failed = true;
    await alert(
      `${label} failed: inspect oracle status, configured hashes, signer, RPC, funds and simulation. No subsequent action assumes it succeeded.`,
    );
  }
}
const opts = { dryRun, alwaysRun, alert };
const block = await client.getBlock(),
  now = block.timestamp,
  collection = await read(shop, "IDENTITY_COLLECTION");
const signer = await read(shop, "oracleSigner");
let ids = {
  floor: [...config.floorRequestIds],
  cap: [...config.marketCapRequestIds],
};
async function latest(kind, consumer, pinned) {
  const valid = [];
  for (const id of new Set(ids[kind])) {
    try {
      const evidence = await loadEvidence(id);
      if (!evidence) continue;
      valid.push(
        await validateEvidence(
          evidence,
          kind,
          consumer.address,
          signer,
          pinned,
          Number(now),
          await signerMode(client, signer),
        ),
      );
    } catch {
      await alert(`Oracle failed or incompatible ${kind} request: ${id}.`);
    }
  }
  return valid.sort((a, b) =>
    a.attestation.issuedAt > b.attestation.issuedAt ? -1 : 1,
  )[0];
}
await isolated("Floor refresh", async () => {
  const floor = await read(shop, "floors", [collection]),
    pinned = (await read(shop, "collections", [collection]))[5];
  if (!(await read(shop, "floorFresh", [collection])))
    await alert(
      "Stale floor: buy a compatible answer on explorer.imd.fun and configure its request id.",
    );
  if (pinned === zeroHash) {
    await alert("Floor question is unset; owner Setup required.");
    return;
  }
  const value = await latest("floor", shop, pinned);
  if (value && value.attestation.issuedAt > floor[1]) {
    const result = await attempt(
      client,
      wallet,
      shop,
      "submitFloor",
      [collection, value.attestation, value.signature],
      floorBounty(floor, await read(shop, "bountyReserve"), now),
      opts,
    );
    console.log(`Floor: ${result.status}`);
  }
});
await isolated("Auction scan", async () => {
  const next = await read(shop, "nextLoanId");
  let cursor = BigInt(state.cursor);
  if (cursor < 1n || cursor >= next) cursor = 1n;
  const batch = Math.max(1, Math.min(1000, config.loanBatchSize ?? 100));
  for (let count = 0; count < batch && cursor < next; count++, cursor++) {
    await isolated(`Loan ${cursor}`, async () => {
      const loan = await read(shop, "getLoan", [cursor]),
        action = loanAction(loan, now);
      if (action === "stuck")
        await alert(`Auction stuck for at least 3 days: loan ${cursor}.`);
      if (action === "start") {
        const result = await attempt(
          client,
          wallet,
          shop,
          "startAuction",
          [cursor],
          auctionBounty(await read(shop, "bountyReserve")),
          opts,
        );
        if (result.status === "confirmed")
          await alert(`Auction started: loan ${cursor}.`);
        else console.log(`Loan ${cursor}: ${result.status}`);
      }
    });
  }
  state.cursor = (cursor >= next ? 1n : cursor).toString();
});
await isolated("Milestone burn", async () => {
  if (await read(burn, "burned")) return;
  const pinned = await read(burn, "questionHash");
  if (pinned === zeroHash) {
    await alert(
      "Burn question unset; immutable question setter must use Setup.",
    );
    return;
  }
  const value = await latest("cap", burn, pinned);
  if (
    value &&
    value.value >= 1000000n * 10n ** 18n &&
    (await read(token, "balanceOf", [burn.address])) > 0n
  ) {
    // MilestoneBurn pays no bounty, so live burns require ALWAYS_RUN=true.
    const result = await attempt(
      client,
      wallet,
      burn,
      "burn",
      [value.attestation, value.signature],
      0n,
      opts,
    );
    if (result.status === "confirmed")
      await alert("Burn fired: one-time PAWN milestone completed.");
    else console.log(`Burn: ${result.status}`);
  }
});
await isolated("Health checks", async () => {
  const pending = await read(shop, "pendingOwner");
  if (!/^0x0{40}$/i.test(pending))
    await alert(`Queued owner change: PawnShop ${pending}.`);
  const poolAddress = await read(shop, "lendingPool");
  const pool = {
    address: poolAddress,
    abi: JSON.parse(
      await readFile(resolve(root, "docs/abi/LendingPool.json"), "utf8"),
    ),
  };
  const poolOwner = await read(pool, "pendingOwner");
  if (!/^0x0{40}$/i.test(poolOwner))
    await alert(`Queued owner change: LendingPool ${poolOwner}.`);
  if ((await read(shop, "bountyReserve")) < BigInt(config.lowBountyReserveWei))
    await alert("Low bounty reserve; owner should fund bounties.");
  if (
    (await read(pool, "shortfallReserve")) <
    ((await read(pool, "totalAssets")) * 5n) / 100n
  )
    await alert("Low pool shortfall reserve (below 5% of assets).");
});
await writeFile(config.stateFile, JSON.stringify(state) + "\n", {
  mode: 0o600,
});
if (failed) process.exitCode = 1;
