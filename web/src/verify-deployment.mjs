import { keccak256 } from "viem";

// Explicit deployment targets supplied for this site, independent of launch 994.
export const TARGETS = Object.freeze({
  PawnShop: "0xf0d9300d7d891bc842da540cc4ddef050da9bcd4",
  FloorRelay: "0x1ff0fb56f9a6c5c5c8201906d487ec4d8f5afc50",
  MilestoneBurn: "0x45098bc496b3fdc870f89b8785047fb0e19ee99a",
  LaunchToken: "0x4f2bacee5f2e7ce3f48dfbd635d96e9a8fcbe478",
});
const same = (a, b, label) => {
  if (typeof a !== "string" || a.toLowerCase() !== b.toLowerCase())
    throw Error(
      `${label} does not match the verified Pawn deployment. Refresh the site before transacting.`,
    );
};

// Used by both prepare.mjs and the browser, before transaction controls unlock.
export async function verifyDeployment(
  client,
  deployment,
  abis,
  relayCodeHash,
) {
  if (deployment.chainId !== 1 || (await client.getChainId()) !== 1)
    throw Error("Pawn requires Ethereum mainnet. Check the RPC network.");
  const block = await client.getBlock();
  const blockNumber = block.number;
  const configured = Object.fromEntries(
    deployment.contracts.map((c) => [c.name, c.address]),
  );
  for (const [name, address] of Object.entries(TARGETS))
    same(configured[name], address, name);
  const read = (name, address, functionName, args = []) =>
    client.readContract({
      address,
      abi: abis[name],
      functionName,
      args,
      blockNumber,
    });
  const addresses = { ...TARGETS };
  for (const [name, getter] of [
    ["LendingPool", "lendingPool"],
    ["LockDiscount", "discountModule"],
    ["VaultFactory", "vaultFactory"],
  ]) {
    addresses[name] = (
      await read("PawnShop", addresses.PawnShop, getter)
    ).toLowerCase();
  }
  const contracts = await Promise.all(
    Object.entries(addresses).map(async ([name, address]) => {
      const code = await client.getCode({ address, blockNumber });
      if (!code || code === "0x")
        throw Error(
          `${name} has no contract code on Ethereum mainnet. Transaction controls are disabled.`,
        );
      return {
        name,
        address,
        codeBytes: (code.length - 2) / 2,
        runtimeCodeHash: keccak256(code),
      };
    }),
  );
  same(
    contracts.find((c) => c.name === "FloorRelay").runtimeCodeHash,
    relayCodeHash,
    "FloorRelay runtime",
  );
  const state = {};
  for (const fn of [
    "owner",
    "oracleSigner",
    "pawnToken",
    "IDENTITY_COLLECTION",
    "nextLoanId",
    "newLoansPaused",
  ])
    state[fn] = await read("PawnShop", addresses.PawnShop, fn);
  // Exercise the deployed audit-fixed Loan tuple, not only getter selectors.
  state.loan = await read("PawnShop", addresses.PawnShop, "getLoan", [0n]);
  same(
    state.oracleSigner,
    addresses.FloorRelay,
    "PawnShop attester (oracleSigner)",
  );
  same(state.pawnToken, addresses.LaunchToken, "PawnShop token");
  for (const name of [
    "LendingPool",
    "LockDiscount",
    "VaultFactory",
    "MilestoneBurn",
  ])
    same(
      await read(name, addresses[name], "pawnShop"),
      addresses.PawnShop,
      `${name} PawnShop binding`,
    );
  for (const name of ["LockDiscount", "MilestoneBurn"])
    same(
      await read(name, addresses[name], "pawnToken"),
      addresses.LaunchToken,
      `${name} token`,
    );
  state.poolOwner = await read("LendingPool", addresses.LendingPool, "owner");
  state.burnSetter = await read(
    "MilestoneBurn",
    addresses.MilestoneBurn,
    "questionSetter",
  );
  state.burnSigner = await read(
    "MilestoneBurn",
    addresses.MilestoneBurn,
    "oracleSigner",
  );
  same(
    state.burnSigner,
    addresses.FloorRelay,
    "MilestoneBurn attester (oracleSigner)",
  );
  state.tokenSymbol = await read(
    "LaunchToken",
    addresses.LaunchToken,
    "symbol",
  );
  return { chainId: 1, blockNumber, blockHash: block.hash, contracts, state };
}
