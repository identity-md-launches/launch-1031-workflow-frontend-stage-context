import { test } from "node:test";
import assert from "node:assert/strict";
import {
  privateKeyToAccount,
  oracleTypes,
  validateEvidence,
  oracleInput,
  question,
  zeroHash,
  signPayment,
  checkChallenge,
  canonical,
  encodePaymentHeader,
  loadEvidence,
  API,
} from "../runtime.mjs";
// Deterministic signing fixture only. No transaction is broadcast by tests.
const signer = privateKeyToAccount("0x" + "11".repeat(32));
const consumer = "0x0cc05d3b2879e8dfd18e987d1a50008506cc3756";
const burn = "0xb0316e0090501b7048e2876d90bb0471a5d7b6fb";
const imd = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
const permit = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const id = "62702d2a-1a38-4543-93cc-7ece5ac20a66";
const now = 1800000000;
async function evidence(kind = "floor") {
  const domain = {
    name: "IdentityMD Oracle",
    version: "2",
    chainId: 1,
    verifyingContract: kind === "floor" ? consumer : burn,
  };
  const m = {
    requestId: "0x" + id.replaceAll("-", "") + "0".repeat(32),
    chainId: 1n,
    questionHash: "0x" + "aa".repeat(32),
    answerType: 3,
    answer:
      "0x" +
      (kind === "floor" ? 10n ** 18n : 1000000n * 10n ** 18n)
        .toString(16)
        .padStart(64, "0"),
    figure: 0n,
    fromBlock: 100n,
    toBlock: 200n,
    blockHash: "0x" + "bb".repeat(32),
    panelJobId: "0x" + "cc".repeat(32),
    panelSize: 5,
    quorum: 4,
    agreed: 4,
    issuedAt: BigInt(now),
    expiresAt: BigInt(now + 93600),
  };
  const signature = await signer.signTypedData({
    domain,
    types: oracleTypes,
    primaryType: "OracleAttestation",
    message: m,
  });
  return {
    id,
    detail: {
      question: question(kind),
      questionHash: m.questionHash,
      answerType: "uint256",
      chainId: 1,
      evidence: "panel",
      toleranceBps: 500,
      signer: signer.address,
    },
    typed: { domain, message: m, signer: signer.address, signature },
  };
}
test("verified floor and cap normalize into deployed tuple; cap meets milestone exactly", async () => {
  const floor = await validateEvidence(
    await evidence(),
    "floor",
    consumer,
    signer.address,
    zeroHash,
    now,
  );
  assert.equal(floor.value, 10n ** 18n);
  assert.equal(floor.attestation.answerType, 3);
  const cap = await validateEvidence(
    await evidence("cap"),
    "cap",
    burn,
    signer.address,
    zeroHash,
    now,
  );
  assert.equal(cap.value, 1000000n * 10n ** 18n);
});
test("reject wrong consumer, signer, request id, hash, question, tolerance, consensus and forged answer", async () => {
  for (const edit of [
    (e) => (e.typed.domain.verifyingContract = burn),
    (e) => (e.typed.signer = consumer),
    (e) => (e.id = "62702d2a-1a38-4543-93cc-7ece5ac20a67"),
    (e) => (e.detail.questionHash = zeroHash),
    (e) => (e.detail.question = "Other floor"),
    (e) => (e.detail.toleranceBps = 501),
    (e) => (e.typed.message.agreed = 3),
    (e) => (e.typed.message.answer = "0x" + "01".repeat(32)),
  ]) {
    const e = await evidence();
    edit(e);
    await assert.rejects(
      validateEvidence(e, "floor", consumer, signer.address, zeroHash, now),
    );
  }
  await assert.rejects(
    validateEvidence(
      await evidence(),
      "floor",
      consumer,
      signer.address,
      "0x" + "ab".repeat(32),
      now,
    ),
    /configured hash/,
  );
});
test("26 hour floor lifetime, stale and future answers are refused", async () => {
  const e = await evidence();
  e.typed.message.expiresAt = BigInt(now + 86400);
  await assert.rejects(
    validateEvidence(e, "floor", consumer, signer.address, zeroHash, now),
    /26 hours/,
  );
  await assert.rejects(
    validateEvidence(
      await evidence(),
      "floor",
      consumer,
      signer.address,
      zeroHash,
      now - 1,
    ),
    /future/,
  );
  await assert.rejects(
    validateEvidence(
      await evidence(),
      "floor",
      consumer,
      signer.address,
      zeroHash,
      now + 93601,
    ),
    /stale/,
  );
});
test("pending oracle does not load signature; failed panel reports failure", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return new Response(JSON.stringify({ status: "running" }), { status: 200 });
  };
  assert.equal(await loadEvidence(id, fetcher), undefined);
  assert.equal(calls, 1);
  await assert.rejects(
    loadEvidence(
      id,
      async () =>
        new Response(
          JSON.stringify({ status: "failed", failure: "no consensus" }),
          { status: 200 },
        ),
    ),
    /no consensus/,
  );
  await assert.rejects(loadEvidence("../secrets", fetcher), /UUID/);
});
function challenge() {
  const input = oracleInput("floor", consumer);
  const payment = {
    network: "eip155:1",
    asset: imd,
    amount: "500000000000000000",
    payTo: signer.address,
    decimals: 18,
  };
  const policy = { payment };
  const url = API + "/requests/" + id + "/submit";
  return {
    input,
    policy,
    ch: {
      x402Version: 2,
      input,
      resource: { url },
      resourceUrl: url,
      requesterScopeHash: "dd".repeat(32),
      quote: {
        id,
        action: "oracle.request",
        payment: { ...payment, scheme: "exact" },
        expiresAt: now + 600,
        quoteHash: "ee".repeat(32),
      },
      accepts: [
        {
          scheme: "exact",
          network: payment.network,
          asset: imd,
          amount: payment.amount,
          payTo: signer.address,
          maxTimeoutSeconds: 600,
          extra: { assetTransferMethod: "permit2" },
        },
      ],
    },
  };
}
test("exact x402 amount and prepared consumer are checked before signing", () => {
  const { input, policy, ch } = challenge();
  assert.equal(
    checkChallenge(ch, input, policy, imd, now).amount,
    "500000000000000000",
  );
  ch.accepts[0].amount = "1000000000000000000";
  assert.throws(() => checkChallenge(ch, input, policy, imd, now), /0.5 IMD/);
  const c = challenge();
  c.ch.input = {
    ...c.input,
    consumer: { chainId: 1, verifyingContract: burn },
  };
  assert.throws(
    () => checkChallenge(c.ch, c.input, c.policy, imd, now),
    /consumer/,
  );
});
test("Permit2 and QuoteApproval bind exact payment bytes; deadline stays inside quote", async () => {
  const { input, policy, ch } = challenge();
  const req = checkChallenge(ch, input, policy, imd, now),
    signed = [];
  const result = await signPayment(
    ch,
    req,
    signer.address,
    permit,
    async (data) => {
      signed.push(data);
      return signer.signTypedData(data);
    },
    42n,
    now,
  );
  assert.equal(signed[0].primaryType, "PermitWitnessTransferFrom");
  assert.equal(signed[1].primaryType, "QuoteApproval");
  assert.equal(signed[0].message.permitted.amount, 500000000000000000n);
  assert.equal(
    Number(result.payment.payload.permit2Authorization.deadline),
    ch.quote.expiresAt - 1,
  );
  assert.equal(result.payment.accepted, req);
  assert.equal("extensions" in result.payment, false);
  assert.equal(canonical({ b: 2, a: 1 }), ' {"a":1,"b":2}'.trim());
});

test("payment header preserves Unicode as base64 UTF-8 JSON", () => {
  const p = { resource: { description: "Pawn — floor" } };
  assert.deepEqual(
    JSON.parse(Buffer.from(encodePaymentHeader(p), "base64").toString("utf8")),
    p,
  );
});
