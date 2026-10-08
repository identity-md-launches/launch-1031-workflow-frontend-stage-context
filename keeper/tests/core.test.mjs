import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attempt,
  profitable,
  loanAction,
  floorBounty,
  auctionBounty,
} from "../core.mjs";
const contract = {
  address: "0x0cc05d3b2879e8dfd18e987d1a50008506cc3756",
  abi: [],
};
const wallet = {
  account: { address: contract.address },
  writes: 0,
  async writeContract() {
    this.writes++;
    return "0xconfirmed";
  },
};
const client = {
  async simulateContract(c) {
    return { request: c };
  },
  async estimateContractGas() {
    return 50000n;
  },
  async estimateFeesPerGas() {
    return { maxFeePerGas: 1000000000n, maxPriorityFeePerGas: 1n };
  },
  async getBalance() {
    return 10n ** 18n;
  },
  async waitForTransactionReceipt() {
    return { status: "success" };
  },
};
test("bounty must cover action, credit claim gas and margin; override permits zero bounty", () => {
  assert.equal(profitable(100000n, 100n, 100n), false);
  assert.equal(profitable(1000000000000000n, 50000n, 1000000000n), true);
  assert.equal(profitable(0n, 50000n, 1000000000n), false);
  assert.equal(profitable(0n, 50000n, 1000000000n, true), true);
});
test("exact grace, stuck-auction and funded bounty boundaries", () => {
  assert.equal(loanAction({ status: 1, due: 100n }, 259300n), "skip");
  assert.equal(loanAction({ status: 1, due: 100n }, 259301n), "start");
  assert.equal(
    loanAction({ status: 2, auctionStarted: 100n }, 259300n),
    "stuck",
  );
  assert.equal(loanAction({ status: 3, due: 0n }, 999999n), "skip");
  assert.equal(floorBounty([0n, 0n, 0n, 100n], 10n ** 18n, 86499n), 0n);
  assert.equal(floorBounty([0n, 0n, 0n, 100n], 10n ** 18n, 86500n), 10n ** 15n);
  assert.equal(floorBounty([0n, 0n, 0n, 0n], 10n ** 15n - 1n, 1n), 0n);
  assert.equal(auctionBounty(2n * 10n ** 15n - 1n), 0n);
});
test("dry run simulates and estimates but never sends; no-bounty burns skipped", async () => {
  const w = { ...wallet, writes: 0 };
  assert.equal(
    (await attempt(client, w, contract, "submitFloor", [], 10n ** 15n)).status,
    "dry-run",
  );
  assert.equal(w.writes, 0);
  assert.equal(
    (await attempt(client, w, contract, "burn", [], 0n, { dryRun: false }))
      .status,
    "unprofitable",
  );
  assert.equal(w.writes, 0);
});
test("live success requires funded keeper; reverted or failed simulations never report success", async () => {
  const w = { ...wallet, writes: 0 };
  let alerts = [];
  assert.equal(
    (
      await attempt(client, w, contract, "startAuction", [], 2n * 10n ** 15n, {
        dryRun: false,
        alert: async (m) => alerts.push(m),
      })
    ).status,
    "confirmed",
  );
  assert.equal(w.writes, 1);
  assert.equal(alerts.length, 1);
  await assert.rejects(
    attempt(
      {
        ...client,
        async simulateContract() {
          throw Error("already posted");
        },
      },
      w,
      contract,
      "submitFloor",
      [],
      10n ** 15n,
      { dryRun: false },
    ),
    /already posted/,
  );
  assert.equal(w.writes, 1);
  await assert.rejects(
    attempt(
      {
        ...client,
        async getBalance() {
          return 0n;
        },
      },
      w,
      contract,
      "burn",
      [],
      0n,
      { dryRun: false, alwaysRun: true },
    ),
    /balance/,
  );
  assert.equal(w.writes, 1);
  await assert.rejects(
    attempt(
      {
        ...client,
        async waitForTransactionReceipt() {
          return { status: "reverted" };
        },
      },
      w,
      contract,
      "burn",
      [],
      0n,
      { dryRun: false, alwaysRun: true },
    ),
    /reverted/,
  );
});
