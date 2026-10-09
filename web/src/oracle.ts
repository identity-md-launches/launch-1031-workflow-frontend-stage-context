import {
  decodeAbiParameters,
  getAddress,
  hashTypedData,
  parseAbiParameters,
  recoverAddress,
  encodeAbiParameters,
  keccak256,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import relayArtifact from "./floor-relay.json";
export const IMD_ATTESTER: Address =
  "0x5598aa9146215bc13eb26f2c692ad1461fd32982";
export const API = "https://api.imd.fun";
export const FLOOR_QUESTION =
  "What is the current floor price, in wei, of the identity.md NFT collection at 0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D on Ethereum mainnet, defined as the lowest active listing on OpenSea or Blur at the time of answering? Answer as a uint256 in wei.";
export const CAP_QUESTION =
  "What is the fully diluted market cap of the PAWN token (0x4f2bacee5f2e7ce3f48dfbd635d96e9a8fcbe478, Ethereum mainnet), computed as total supply times its 24-hour time-weighted average price from its Uniswap v4 ETH pool, converted to USD at the current ETH price? Answer as a uint256 in USD with 18 decimals.";
export const BURN_MAX_AGE = 3600;
export const BURN_MILESTONE = 1000000n * 10n ** 18n;
export function evidenceDeadline(
  kind: Kind,
  attestation: { issuedAt: bigint; expiresAt: bigint },
) {
  return Math.min(
    Number(attestation.issuedAt) + (kind === "cap" ? BURN_MAX_AGE : 93600),
    Number(attestation.expiresAt),
  );
}
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
export const relayParameters = [
  { type: "tuple", components: oracleTypes.OracleAttestation },
  { type: "bytes" },
] as const;
export function packRelay(attestation: any, signature: Hex): Hex {
  return encodeAbiParameters(relayParameters, [attestation, signature]);
}
export function isFloorRelay(code?: Hex) {
  return (
    !!code && code !== "0x" && keccak256(code) === relayArtifact.runtimeCodeHash
  );
}
// Discover the actual governed signer, without inventing a relay deployment address.
export async function signerMode(
  client: { getCode: (args: { address: Address }) => Promise<Hex | undefined> },
  signer: Address,
) {
  const code = await client.getCode({ address: signer });
  if (isFloorRelay(code)) return "relay" as const;
  if (!code || code === "0x") return "direct" as const;
  throw Error(
    "The governed contract attester is not the verified FloorRelay build.",
  );
}
export const zeroHash = `0x${"0".repeat(64)}`;
export const question = (kind: Kind) =>
  kind === "floor" ? FLOOR_QUESTION : CAP_QUESTION;
export function uuid(id: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    throw Error("Enter an oracle request UUID.");
  return id.toLowerCase();
}
export type OracleReadOptions = {
  signal?: AbortSignal;
  onRetry?: (message: string) => void;
  // Injectable clock for bounded, deterministic retry tests.
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
};
export const BUSY_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000] as const;
function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
export function oracleError(error: unknown) {
  if (
    error instanceof Error &&
    !/Load failed|Failed to fetch|NetworkError|fetch failed/i.test(
      error.message,
    )
  )
    return error.message;
  return "The oracle service could not be reached from this browser. Check your connection and try again.";
}
function serviceMessage(body: any, status: number) {
  const message = [
    body?.message,
    body?.detail,
    body?.error?.message,
    body?.error,
  ].find((x) => typeof x === "string" && x.trim());
  if (message?.toLowerCase() === "busy") return "The oracle service is busy.";
  if (message === "not_found")
    return "The oracle request was not found. Check the request or job id, then try again.";
  if (message) return oracleError(new Error(message));
  return `The oracle service could not answer this request (HTTP ${status}). Try again.`;
}
export async function apiJSON(
  path: string,
  init?: RequestInit,
  fetcher: typeof fetch = fetch,
  options: OracleReadOptions = {},
) {
  for (let retry = 0; ; retry++) {
    options.signal?.throwIfAborted();
    let response: Response;
    try {
      const timeout = AbortSignal.timeout(20000);
      const signal = options.signal ?? init?.signal;
      response = await fetcher(API + path, {
        ...init,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      options.signal?.throwIfAborted();
      const message =
        error instanceof DOMException && error.name === "TimeoutError"
          ? "The oracle service took too long to respond. Try again."
          : oracleError(error);
      // A busy gateway may omit CORS headers, so browsers expose only a
      // transport error. Apply the same bounded retry budget in that case.
      if (retry === BUSY_BACKOFF_MS.length)
        throw Error(`${message} Still unavailable after 5 retries.`);
      options.onRetry?.(
        `${message} Retrying ${retry + 1} of 5 in ${BUSY_BACKOFF_MS[retry] / 1000} seconds…`,
      );
      await (options.wait ?? waitForRetry)(
        BUSY_BACKOFF_MS[retry],
        options.signal,
      );
      continue;
    }
    let body: any;
    try {
      body = await response.json();
    } catch {
      throw Error(
        `The oracle service returned an unreadable response (HTTP ${response.status}). Try again.`,
      );
    }
    const busy =
      body?.error === "busy" ||
      body?.error?.code === "busy" ||
      [429, 503].includes(response.status);
    if (busy) {
      const message = serviceMessage(body, response.status);
      if (retry === BUSY_BACKOFF_MS.length)
        throw Error(
          `${message} Still unavailable after 5 retries. Try again shortly.`,
        );
      options.onRetry?.(
        `${message} Retrying ${retry + 1} of 5 in ${BUSY_BACKOFF_MS[retry] / 1000} seconds…`,
      );
      await (options.wait ?? waitForRetry)(
        BUSY_BACKOFF_MS[retry],
        options.signal,
      );
      continue;
    }
    if (!response.ok || body?.error)
      throw Error(serviceMessage(body, response.status));
    return body;
  }
}
export async function listRequests(
  fetcher: typeof fetch = fetch,
  options: OracleReadOptions = {},
  limit = 100,
) {
  const body = await apiJSON(
    `/oracle/requests?limit=${limit}`,
    undefined,
    fetcher,
    options,
  );
  if (!Array.isArray(body.requests))
    throw Error(
      "The oracle service returned an unreadable request list. Try again.",
    );
  return body.requests as any[];
}
export async function resolveRequest(
  id: string,
  fetcher: typeof fetch = fetch,
  options: OracleReadOptions = {},
) {
  id = uuid(id.trim());
  const match = (r: any) =>
    r.id?.toLowerCase() === id || r.jobId?.toLowerCase() === id;
  let found = (await listRequests(fetcher, options)).find(match);
  if (!found) found = (await listRequests(fetcher, options, 1000)).find(match);
  // Exact request UUIDs still work after aging out of the public list.
  return found ? uuid(found.id) : id;
}
export async function latestRequest(
  kind: Kind,
  fetcher: typeof fetch = fetch,
  options: OracleReadOptions = {},
) {
  const matching = (requests: any[]) =>
    requests
      .filter((r) => r.question === question(kind) && r.chainId === 1)
      .sort((a, b) =>
        String(b.createdAt).localeCompare(String(a.createdAt)),
      )[0];
  const match =
    matching(await listRequests(fetcher, options)) ??
    matching(await listRequests(fetcher, options, 1000));
  if (!match)
    throw Error(
      "No recent request matches this question. Buy the question on the explorer, then try again.",
    );
  return uuid(match.id);
}
export async function loadEvidence(
  id: string,
  fetcher: typeof fetch = fetch,
  options: OracleReadOptions = {},
) {
  const requestId = await resolveRequest(id, fetcher, options);
  // Browser-tested CORS route. Its response already contains the signed struct.
  // /attestation has no CORS headers and must never be fetched by the browser.
  const detail = await apiJSON(
    `/oracle/requests/${requestId}`,
    undefined,
    fetcher,
    options,
  );
  if (uuid(detail.id) !== requestId)
    throw Error("The oracle returned a different request. Try again.");
  if (
    ["failed", "refused", "cancelled"].includes(detail.status) ||
    detail.failure
  )
    throw Error(
      `Oracle request ${detail.status}: ${typeof detail.failure === "string" ? detail.failure : (detail.failure?.message ?? detail.message ?? "Buy a new request on the explorer and try again.")}`,
    );
  if (detail.status !== "attested") return undefined;
  if (!detail.attestation || !detail.signature || !detail.signer)
    throw Error(
      "The oracle marked this request complete but has not supplied its signed answer. Try again shortly.",
    );
  // Reconstruct the documented EIP-712 v2 domain for the inline signed struct.
  // The signature is still independently recovered against the governed signer;
  // a different/forged domain cannot turn into approvable evidence.
  const typed = {
    requestId,
    domain: {
      name: "IdentityMD Oracle",
      version: "2",
      chainId: detail.chainId,
      verifyingContract: detail.consumer ?? zeroAddress,
    },
    primaryType: "OracleAttestation",
    types: oracleTypes,
    message: detail.attestation,
    signature: detail.signature,
    signer: detail.signer,
  };
  return { id: requestId, detail, typed };
}
export async function validateEvidence(
  e: any,
  kind: Kind,
  consumer: Address,
  signer: Address,
  pinned: string,
  now: number,
  mode: "direct" | "relay" = "direct",
) {
  const expectedSigner = mode === "relay" ? IMD_ATTESTER : signer;
  const signingConsumer = mode === "relay" ? zeroAddress : consumer;
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
    domain.verifyingContract?.toLowerCase() !== signingConsumer.toLowerCase()
  )
    throw Error(
      mode === "relay"
        ? "FloorRelay requires an answer signed with no consumer on chain 1."
        : "Until the FloorRelay switch lands, only answers signed for this contract are accepted.",
    );
  if (
    t.signer?.toLowerCase() !== expectedSigner.toLowerCase() ||
    d.signer?.toLowerCase() !== expectedSigner.toLowerCase()
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
      "This question hash differs from the configured hash. The owner must approve this request's hash with approveQuestionHash (floor) or re-pin with replaceQuestionHash (burn) first.",
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
    BigInt(now) - a.issuedAt > BigInt(kind === "cap" ? BURN_MAX_AGE : 93600) ||
    a.expiresAt < BigInt(now)
  )
    throw Error(
      kind === "cap"
        ? "Market-cap answer is over 1 hour old, expired or issued in the future. Fetch a fresh request before pinning or burning."
        : "Attestation is stale, expired or issued in the future. Fetch a fresh floor request.",
    );
  // The contract accepts any signed lifetime and is never fresh past the signed expiry.
  if (kind === "floor" && a.expiresAt <= a.issuedAt)
    throw Error("Floor attestation must expire after it was issued.");
  const digest = hashTypedData({
    domain: {
      name: "IdentityMD Oracle",
      version: "2",
      chainId: 1,
      verifyingContract: signingConsumer,
    },
    types: oracleTypes,
    primaryType: "OracleAttestation",
    message: a,
  });
  if (
    (
      await recoverAddress({ hash: digest, signature: t.signature })
    ).toLowerCase() !== expectedSigner.toLowerCase()
  )
    throw Error("Invalid oracle signature.");
  const [value] = decodeAbiParameters(parseAbiParameters("uint256"), a.answer);
  if (kind === "floor" && value === 0n) throw Error("Floor must be positive.");
  if (!/^0x[0-9a-f]{130}$/i.test(t.signature))
    throw Error("Expected a 65-byte IMD signature.");
  return {
    attestation: a,
    signature:
      mode === "relay" ? packRelay(a, t.signature) : (t.signature as Hex),
    value,
  };
}
