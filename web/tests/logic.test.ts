import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeAbiParameters,
  parseAbiParameters,
  parseEther,
  zeroAddress,
} from "viem";
import {
  amount,
  uint,
  fee,
  slippage,
  swapPayload,
  switchChain,
  parseInput,
  friendlyError,
} from "../src/logic";
import { canonicalAbiHash, relativePath, type Deployment } from "../src/config";
import { readFileSync } from "node:fs";
const deployment = JSON.parse(
  readFileSync(new URL("../deployment.json", import.meta.url), "utf8"),
);
const network = JSON.parse(
  readFileSync(new URL("../network.json", import.meta.url), "utf8"),
);
const config = { ...deployment, ...network } as Deployment;
test("pinned implementation ABIs match canonical handoff hashes", () => {
  for (const c of deployment.contracts) {
    assert.equal(
      canonicalAbiHash(
        JSON.parse(
          readFileSync(
            new URL(`../../docs/abi/${c.name}.json`, import.meta.url),
            "utf8",
          ),
        ),
      ),
      c.abiHash,
    );
  }
});
test("amount validation rejects unsafe values and preserves exact token units", () => {
  assert.equal(amount("1.123456", 6), 1123456n);
  for (const s of ["-1", "1e18", "0", "0.0000001", "NaN", "Infinity"])
    assert.throws(() => amount(s, 6));
  assert.equal(uint("0"), 0n);
  assert.throws(() => uint("-2"));
});
test("fee rounding favors the pool at every tier", () => {
  assert.equal(fee(101n, 300, 0), 4n);
  assert.equal(fee(101n, 300, 1), 4n);
  assert.equal(fee(parseEther("1"), 300, 2), 20001000000000000n);
  assert.equal(fee(parseEther("1"), 300, 3), 15000000000000000n);
});
test("slippage has bounded basis-point precision", () => {
  assert.equal(slippage("0.50"), 50n);
  assert.equal(slippage("0.29"), 29n);
  assert.equal(slippage("0.05"), 5n);
  assert.equal(slippage("5"), 500n);
  for (const s of ["0", "10", "0.123", "NaN"]) assert.throws(() => slippage(s));
});
for (const extended of [false, true])
  test(`Uniswap action encoding preserves pool key and amounts (${extended ? "extended" : "standard"})`, () => {
    const input = swapPayload(deployment.poolKey, true, 10n, 8n, extended);
    const [actions, params] = decodeAbiParameters(
      parseAbiParameters("bytes,bytes[]"),
      input,
    );
    assert.equal(actions, "0x060c0f");
    const [p] = decodeAbiParameters(
      parseAbiParameters(
        `((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,${extended ? "uint256 minHopPriceX36," : ""}bytes hookData)`,
      ),
      params[0],
    );
    assert.equal(p.poolKey.hooks.toLowerCase(), deployment.poolKey.hooks);
    assert.equal(p.poolKey.fee, 12500);
    assert.equal(p.amountIn, 10n);
    assert.equal(p.amountOutMinimum, 8n);
    assert.deepEqual(
      decodeAbiParameters(parseAbiParameters("address,uint256"), params[1]),
      [zeroAddress, 10n],
    );
    assert.equal((p as any).minHopPriceX36, extended ? 0n : undefined);
  });
test("unknown chain offers exact add-chain parameters then retries switch", async () => {
  const calls: any[] = [];
  await switchChain(
    {
      request: async (x) => {
        calls.push(x);
        if (calls.length === 1) throw { code: 4902 };
      },
    },
    config,
  );
  assert.deepEqual(
    calls.map((x) => x.method),
    [
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ],
  );
  assert.deepEqual(calls[1].params, [network.walletAddChain]);
});
test("wallet rejection never adds a chain", async () => {
  const calls: any[] = [];
  await assert.rejects(
    switchChain(
      {
        request: async (x) => {
          calls.push(x);
          throw { code: 4001 };
        },
      },
      config,
    ),
  );
  assert.equal(calls.length, 1);
  assert.match(friendlyError({ code: 4001 }), /rejected/);
});
test("oracle and pairing parsers preserve large integers and reject malformed input", () => {
  assert.equal(
    parseInput({ name: "tokenId", type: "uint256" }, "9007199254740993"),
    9007199254740993n,
  );
  assert.throws(() =>
    parseInput({ name: "tokenId", type: "uint256" }, 9007199254740993),
  );
  assert.throws(() => parseInput({ name: "hash", type: "bytes32" }, "0x12"));
  assert.throws(() =>
    parseInput({ name: "recipient", type: "address" }, zeroAddress),
  );
  assert.equal(parseInput({ name: "enabled", type: "bool" }, "false"), false);
});
test("asset paths cannot leave the static export", () => {
  for (const p of [
    "../private",
    "https://example.com/abi",
    "/abi.json",
    "a\\b",
  ])
    assert.throws(() => relativePath(p));
  assert.equal(relativePath("abi/PawnShop.json"), "abi/PawnShop.json");
});
