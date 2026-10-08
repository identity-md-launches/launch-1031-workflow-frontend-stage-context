import {
  decodeAbiParameters,
  getAddress,
  hashTypedData,
  parseAbiParameters,
  recoverAddress,
  sha256,
  stringToBytes,
  type Address,
  type Hex,
} from "viem";
export const API = "https://api.imd.fun";
export const FLOOR_QUESTION =
  "What is the current floor price, in wei, of the identity.md NFT collection at 0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D on Ethereum mainnet, defined as the lowest active listing on OpenSea or Blur at the time of answering? Answer as a uint256 in wei.";
export const CAP_QUESTION =
  "What is the fully diluted market cap of the PAWN token (0x4f2bacee5f2e7ce3f48dfbd635d96e9a8fcbe478, Ethereum mainnet), computed as total supply times the spot price from its Uniswap v4 ETH pool, converted to USD at the current ETH price? Answer as a uint256 in USD with 18 decimals.";
export type Kind = "floor" | "cap";
export const oracleTypes = {
  OracleAttestation: [
    ["requestId", "bytes32"],
    ["chainId", "uint256"],
    ["questionHash", "bytes32"],
    ["answerType", "uint8"],
    ["answer", "bytes"],
    ["figure", "uint256"],
    ["fromBlock", "uint64"],
    ["toBlock", "uint64"],
    ["blockHash", "bytes32"],
    ["panelJobId", "bytes32"],
    ["panelSize", "uint16"],
    ["quorum", "uint16"],
    ["agreed", "uint16"],
    ["issuedAt", "uint64"],
    ["expiresAt", "uint64"],
  ].map(([name, type]) => ({ name, type })),
};
export const zeroHash = `0x${"0".repeat(64)}`;
export const question = (kind: Kind) =>
  kind === "floor" ? FLOOR_QUESTION : CAP_QUESTION;
export function oracleInput(kind: Kind, consumer: Address, poolKey?: unknown) {
  return {
    v: 1,
    question: question(kind),
    chainId: 1,
    window: { hours: 24 },
    answerType: "uint256",
    evidence: "panel",
    panelSize: 5,
    quorum: 4,
    toleranceBps: 500,
    validForSeconds: 93600,
    consumer: { chainId: 1, verifyingContract: consumer },
    definitions: {
      time: "Use current public observations at answering time. The block window timestamps the request; it is not a historical average.",
      metric:
        kind === "floor"
          ? "Lowest active ETH-denominated listing across OpenSea or Blur; convert the exact decimal ETH to wei."
          : "Total PAWN supply times its ETH spot price from the deployed Uniswap v4 pool, times current ETH/USD; output USD with 18 decimals.",
      ...(kind === "cap" ? { pool: JSON.stringify(poolKey) } : {}),
    },
    guards: {
      sources:
        kind === "floor"
          ? [
              "https://opensea.io/",
              "https://api.opensea.io/",
              "https://blur.io/",
              "https://core-api.prod.blur.io/",
            ]
          : [
              "https://etherscan.io/",
              "https://app.uniswap.org/",
              "https://api.coingecko.com/",
              "https://www.coingecko.com/",
              "https://ethereum-rpc.publicnode.com/",
            ],
      minSources: 1,
    },
  };
}
export function uuid(id: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    throw Error("Enter an oracle request UUID.");
  return id.toLowerCase();
}
export async function apiJSON(
  path: string,
  init?: RequestInit,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(API + path, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(20000),
  });
  const body = await response.json();
  if (!response.ok && response.status !== 402)
    throw Error(
      `${response.status}: ${body.detail ?? body.error ?? "Oracle service unavailable"}`,
    );
  return body;
}
export async function loadEvidence(id: string, fetcher: typeof fetch = fetch) {
  id = uuid(id);
  const detail = await apiJSON(`/oracle/requests/${id}`, undefined, fetcher);
  if (
    ["failed", "refused", "cancelled"].includes(detail.status) ||
    detail.failure
  )
    throw Error(
      `Oracle failed: ${typeof detail.failure === "string" ? detail.failure : detail.status}`,
    );
  if (detail.status !== "attested") return undefined;
  const typed = await apiJSON(
    `/oracle/requests/${id}/attestation`,
    undefined,
    fetcher,
  );
  return { id, detail, typed };
}
export async function validateEvidence(
  e: any,
  kind: Kind,
  consumer: Address,
  signer: Address,
  pinned: string,
  now: number,
) {
  const d = e.detail,
    t = e.typed,
    m = t.message,
    domain = t.domain;
  if (
    d.question !== question(kind) ||
    d.answerType !== "uint256" ||
    d.chainId !== 1 ||
    d.evidence !== "panel" ||
    !Number.isInteger(d.toleranceBps) ||
    d.toleranceBps > 500 ||
    d.toleranceBps < 0
  )
    throw Error(
      "Request question, public panel evidence, chain or tolerance does not match.",
    );
  if (
    domain?.name !== "IdentityMD Oracle" ||
    domain.version !== "2" ||
    Number(domain.chainId) !== 1 ||
    domain.verifyingContract?.toLowerCase() !== consumer.toLowerCase()
  )
    throw Error(
      "Attestation consumer does not match this deployed contract on chain 1.",
    );
  if (
    t.signer?.toLowerCase() !== signer.toLowerCase() ||
    d.signer?.toLowerCase() !== signer.toLowerCase()
  )
    throw Error("Attester does not match the governed on-chain signer.");
  const a: any = {
    ...m,
    answerType: m.answerType === "uint256" ? 3 : Number(m.answerType),
  };
  for (const k of [
    "chainId",
    "figure",
    "fromBlock",
    "toBlock",
    "issuedAt",
    "expiresAt",
  ])
    a[k] = BigInt(m[k]);
  const requestHash = `0x${uuid(e.id).replaceAll("-", "")}${"0".repeat(32)}`;
  if (
    a.requestId?.toLowerCase() !== requestHash ||
    a.questionHash !== d.questionHash ||
    !/^0x[0-9a-f]{64}$/i.test(a.questionHash) ||
    a.questionHash === zeroHash
  )
    throw Error("Request id or question hash mismatch.");
  if (
    pinned !== zeroHash &&
    a.questionHash.toLowerCase() !== pinned.toLowerCase()
  )
    throw Error(
      "This question hash differs from the configured hash. The owner must review the oracle recipe and queue a collection change; the burn hash cannot be changed.",
    );
  if (
    a.chainId !== 1n ||
    a.answerType !== 3 ||
    !/^0x[0-9a-f]{64}$/i.test(a.answer) ||
    a.panelSize < 5 ||
    a.quorum < 4 ||
    a.agreed < a.quorum ||
    a.agreed > a.panelSize ||
    a.quorum > a.panelSize
  )
    throw Error("Invalid typed answer or panel consensus.");
  if (
    a.issuedAt > BigInt(now) ||
    BigInt(now) - a.issuedAt > 93600n ||
    a.expiresAt < BigInt(now)
  )
    throw Error("Attestation is stale, expired or issued in the future.");
  if (kind === "floor" && a.expiresAt < a.issuedAt + 93600n)
    throw Error(
      "Floor attestation must remain valid for at least 26 hours after issue.",
    );
  const digest = hashTypedData({
    domain: {
      name: "IdentityMD Oracle",
      version: "2",
      chainId: 1,
      verifyingContract: consumer,
    },
    types: oracleTypes,
    primaryType: "OracleAttestation",
    message: a,
  });
  if (
    (
      await recoverAddress({ hash: digest, signature: t.signature })
    ).toLowerCase() !== signer.toLowerCase()
  )
    throw Error("Invalid oracle signature.");
  const [value] = decodeAbiParameters(parseAbiParameters("uint256"), a.answer);
  if (kind === "floor" && value === 0n) throw Error("Floor must be positive.");
  return { attestation: a, signature: t.signature as Hex, value };
}
export function canonical(v: any): string {
  return v === null
    ? "null"
    : Array.isArray(v)
      ? `[${v.map(canonical).join(",")}]`
      : typeof v === "object"
        ? `{${Object.keys(v)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
            .join(",")}}`
        : JSON.stringify(v);
}
// Exact x402 Permit2 proxy, @x402/evm 2.28.0. Code verified on mainnet 2026-10-08.
export const PAYMENT_PROXY: Address =
  "0x402085c248EeA27D92E8b30b2C58ed07f9E20001";
export const paymentTypes = {
  PermitWitnessTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "witness", type: "Witness" },
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  Witness: [
    { name: "to", type: "address" },
    { name: "validAfter", type: "uint256" },
  ],
};
export const approvalTypes = {
  QuoteApproval: [
    ["resource", "string"],
    ["requesterScopeHash", "bytes32"],
    ["quoteId", "string"],
    ["quoteHash", "bytes32"],
    ["paymentHash", "bytes32"],
    ["action", "string"],
    ["asset", "address"],
    ["amount", "uint256"],
    ["payTo", "address"],
    ["expiresAt", "uint256"],
  ].map(([name, type]) => ({ name, type })),
};
export function checkChallenge(
  ch: any,
  input: any,
  policy: any,
  asset: Address,
  now: number,
) {
  const req = ch.accepts?.[0],
    q = ch.quote;
  if (
    ch.x402Version !== 2 ||
    !req ||
    req.scheme !== "exact" ||
    req.network !== "eip155:1" ||
    req.asset?.toLowerCase() !== asset.toLowerCase() ||
    req.amount !== "500000000000000000" ||
    req.extra?.assetTransferMethod !== "permit2" ||
    req.payTo?.toLowerCase() !== policy.payment.payTo.toLowerCase() ||
    q?.action !== "oracle.request" ||
    q.expiresAt <= now + 30
  )
    throw Error(
      "Unexpected payment challenge. Expected exactly 0.5 IMD on Ethereum via Permit2.",
    );
  if (
    canonical(q.payment) !==
      canonical({ ...policy.payment, scheme: "exact" }) &&
    (q.payment.amount !== req.amount ||
      q.payment.asset?.toLowerCase() !== req.asset.toLowerCase() ||
      q.payment.payTo?.toLowerCase() !== req.payTo.toLowerCase() ||
      q.payment.network !== req.network)
  )
    throw Error("Quote payment mismatch.");
  for (const key of [
    "question",
    "chainId",
    "answerType",
    "evidence",
    "panelSize",
    "quorum",
    "toleranceBps",
    "validForSeconds",
    "consumer",
    "definitions",
    "guards",
  ])
    if (canonical(ch.input?.[key]) !== canonical(input[key]))
      throw Error(`Prepared oracle input changed: ${key}. No payment signed.`);
  if (
    ch.resourceUrl !== `${API}/requests/${q.id}/submit` ||
    ch.resource?.url !== ch.resourceUrl
  )
    throw Error("Unexpected payment resource.");
  return req;
}
export async function signPayment(
  ch: any,
  req: any,
  account: Address,
  permit2: Address,
  sign: (data: any) => Promise<Hex>,
  nonce: bigint,
  now: number,
) {
  const deadline = BigInt(
    Math.min(now + req.maxTimeoutSeconds, ch.quote.expiresAt - 1),
  );
  if (deadline <= BigInt(now)) throw Error("Payment window expired.");
  const authorization = {
    from: account,
    permitted: { token: getAddress(req.asset), amount: req.amount },
    spender: PAYMENT_PROXY,
    nonce: nonce.toString(),
    deadline: deadline.toString(),
    witness: { to: getAddress(req.payTo), validAfter: "0" },
  };
  const signature = await sign({
    domain: { name: "Permit2", chainId: 1, verifyingContract: permit2 },
    types: paymentTypes,
    primaryType: "PermitWitnessTransferFrom",
    message: {
      permitted: {
        token: authorization.permitted.token,
        amount: BigInt(req.amount),
      },
      spender: PAYMENT_PROXY,
      nonce,
      deadline,
      witness: { to: authorization.witness.to, validAfter: 0n },
    },
  });
  const payment = {
    x402Version: 2,
    resource: ch.resource,
    accepted: req,
    payload: { signature, permit2Authorization: authorization },
  };
  const q = ch.quote;
  const quoteSignature = await sign({
    domain: { name: "IdentityMD Paid Action", version: "1", chainId: 1 },
    types: approvalTypes,
    primaryType: "QuoteApproval",
    message: {
      resource: ch.resourceUrl,
      requesterScopeHash: `0x${ch.requesterScopeHash}`,
      quoteId: q.id,
      quoteHash: `0x${q.quoteHash}`,
      paymentHash: sha256(stringToBytes(canonical(payment))),
      action: q.action,
      asset: q.payment.asset,
      amount: BigInt(q.payment.amount),
      payTo: q.payment.payTo,
      expiresAt: BigInt(q.expiresAt),
    },
  });
  return { payment, quoteSignature };
}

export function encodePaymentHeader(payment: unknown) {
  return btoa(
    Array.from(new TextEncoder().encode(JSON.stringify(payment)), (b) =>
      String.fromCharCode(b),
    ).join(""),
  );
}
