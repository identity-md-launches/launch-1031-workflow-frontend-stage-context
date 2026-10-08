import {
  createPublicClient,
  http,
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
  parseAbi,
} from "viem";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { dist, root, json } from "./common.mjs";
const d = json(resolve(dist, "imd-deployment.json"));
const report = {
  checkedAt: new Date().toISOString(),
  mode: "Read-only; no wallet connection, simulation or broadcast",
  rpcs: [],
  contracts: [],
  state: {},
};
for (const url of d.network.rpcUrls) {
  try {
    const c = createPublicClient({
      transport: http(url, { timeout: 15000, retryCount: 0 }),
    });
    report.rpcs.push({
      url,
      chainId: await c.getChainId(),
      block: String(await c.getBlockNumber()),
    });
  } catch (e) {
    report.rpcs.push({ url, error: e.shortMessage ?? e.message });
  }
}
const c = createPublicClient({
  transport: http(d.network.rpcUrls[0], { timeout: 15000, retryCount: 0 }),
});
const read = (name, address, fn, args = []) =>
  c.readContract({
    address,
    abi: json(resolve(dist, "abi", name + ".json")),
    functionName: fn,
    args,
  });
for (const contract of d.contracts) {
  const code = await c.getCode({ address: contract.address });
  report.contracts.push({
    name: contract.name,
    address: contract.address,
    codeBytes: code ? (code.length - 2) / 2 : 0,
  });
}
const shop = d.contracts.find((c) => c.name === "PawnShop").address;
const burn = d.contracts.find((c) => c.name === "MilestoneBurn").address;
const pool = await read("PawnShop", shop, "lendingPool"),
  lock = await read("PawnShop", shop, "discountModule"),
  collection = await read("PawnShop", shop, "IDENTITY_COLLECTION");
for (const [name, address] of [
  ["LendingPool", pool],
  ["LockDiscount", lock],
])
  report.contracts.push({
    name,
    address,
    codeBytes: ((await c.getCode({ address })).length - 2) / 2,
  });
for (const fn of [
  "owner",
  "newLoansPaused",
  "oracleSigner",
  "bountyReserve",
  "nextLoanId",
])
  report.state[fn] = await read("PawnShop", shop, fn);
report.state.collection = collection;
report.state.collectionConfig = await read("PawnShop", shop, "collections", [
  collection,
]);
report.state.floor = await read("PawnShop", shop, "floors", [collection]);
report.state.floorFresh = await read("PawnShop", shop, "floorFresh", [
  collection,
]);
report.state.pool = {};
for (const fn of [
  "totalAssets",
  "depositCap",
  "idleAssets",
  "totalBorrowed",
  "cumulativeLoanFees",
  "shortfallReserve",
])
  report.state.pool[fn] = await read("LendingPool", pool, fn);
report.state.burn = {};
for (const fn of ["burned", "questionHash", "burnedAmount"])
  report.state.burn[fn] = await read("MilestoneBurn", burn, fn);
const poolId = keccak256(
  encodeAbiParameters(
    parseAbiParameters(
      "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
    ),
    [d.poolKey],
  ),
);
try {
  report.state.swapPool = {
    id: poolId,
    liquidity: await c.readContract({
      address: d.network.uniswapV4.stateView,
      abi: parseAbi(["function getLiquidity(bytes32) view returns (uint128)"]),
      functionName: "getLiquidity",
      args: [poolId],
    }),
  };
} catch (e) {
  report.state.swapPool = { error: e.shortMessage ?? e.message };
}
writeFileSync(
  resolve(root, "docs/frontend/live-read.json"),
  JSON.stringify(report, (_, v) => (typeof v === "bigint" ? String(v) : v), 2) +
    "\n",
);
console.log(
  JSON.stringify(report, (_, v) => (typeof v === "bigint" ? String(v) : v), 2),
);
