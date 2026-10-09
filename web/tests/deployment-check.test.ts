import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256 } from "viem";
import { verifyDeployment, TARGETS } from "../src/verify-deployment.mjs";
import deployment from "../deployment.json";
const children = Object.fromEntries(
  deployment.contracts
    .filter((c) =>
      ["LendingPool", "LockDiscount", "VaultFactory"].includes(c.name),
    )
    .map((c) => [c.name, c.address]),
);
function fixture() {
  const calls: any[] = [];
  const read: any = {
    owner: "0x23e5d7a7b4ea19530ec39c67cd46aa8c10d15acf",
    oracleSigner: TARGETS.FloorRelay,
    pawnToken: TARGETS.LaunchToken,
    pawnShop: TARGETS.PawnShop,
    lendingPool: children.LendingPool,
    discountModule: children.LockDiscount,
    vaultFactory: children.VaultFactory,
    IDENTITY_COLLECTION: "0x0000ec93127baa929e58e97dd0095a2bfb38ec1d",
    getLoan: { status: 0 },
    nextLoanId: 1n,
    newLoansPaused: true,
    questionSetter: "0x23e5d7a7b4ea19530ec39c67cd46aa8c10d15acf",
    symbol: "PAWN",
  };
  const client: any = {
    getChainId: async () => 1,
    getBlock: async () => ({ number: 26156809n, hash: "0x" + "ab".repeat(32) }),
    getCode: async () => "0x60016000",
    readContract: async (c: any) => {
      calls.push(c);
      return read[c.functionName];
    },
  };
  return {
    client,
    read,
    calls,
    verify: () =>
      verifyDeployment(client, deployment as any, {}, keccak256("0x60016000")),
  };
}
test("verification uses the supplied mainnet targets, discovers all three children and decodes getLoan at one block", async () => {
  const f = fixture();
  const r = await f.verify();
  assert.equal(r.contracts.length, 7);
  assert.deepEqual(
    r.contracts
      .filter((c) => c.name in children)
      .map((c) => c.address)
      .sort(),
    Object.values(children).sort(),
  );
  assert(f.calls.some((c) => c.functionName === "getLoan"));
  assert(f.calls.every((c) => c.blockNumber === 26156809n));
});
test("wrong network, missing bytecode and changed relay runtime fail verification", async () => {
  let f = fixture();
  f.client.getChainId = async () => 11155111;
  await assert.rejects(f.verify(), /mainnet/);
  f = fixture();
  f.client.getCode = async () => "0x";
  await assert.rejects(f.verify(), /no contract code/);
  f = fixture();
  f.client.getCode = async () => "0x6000";
  await assert.rejects(f.verify(), /FloorRelay runtime/);
});
test("old launch address, incorrect child binding and failed ABI key call cannot enable transactions", async () => {
  const f = fixture();
  const wrong = structuredClone(deployment);
  wrong.contracts.find((c) => c.name === "PawnShop")!.address =
    deployment.tokenLaunch.contracts.find(
      (c) => c.name === "PawnShop",
    )!.address;
  await assert.rejects(
    verifyDeployment(f.client, wrong as any, {}, keccak256("0x60016000")),
    /PawnShop does not match/,
  );
  f.read.pawnShop = TARGETS.LaunchToken;
  await assert.rejects(f.verify(), /PawnShop binding/);
  const g = fixture();
  g.client.readContract = async () => {
    throw Error("ABI decoding failed");
  };
  await assert.rejects(g.verify(), /ABI decoding failed/);
});
