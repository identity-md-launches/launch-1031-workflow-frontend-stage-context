import {
  encodeAbiParameters,
  getAddress,
  isAddress,
  parseAbiParameters,
  parseUnits,
  type AbiParameter,
  type Address,
  type Hex,
} from "viem";
import type { PoolKey, Provider, Deployment } from "./config";
export function amount(s: string, decimals = 18) {
  if (
    !/^(0|[1-9]\d*)(\.\d+)?$/.test(s.trim()) ||
    (s.split(".")[1]?.length ?? 0) > decimals
  )
    throw Error(
      `Enter a positive amount with at most ${decimals} decimal places.`,
    );
  const n = parseUnits(s, decimals);
  if (n <= 0n) throw Error("Enter an amount greater than zero.");
  return n;
}
export function uint(s: string) {
  if (!/^\d+$/.test(s.trim()))
    throw Error("Enter a whole number, zero or greater.");
  return BigInt(s);
}
export function address(s: string): Address {
  if (!isAddress(s.trim())) throw Error("Enter a valid Ethereum address.");
  const a = getAddress(s.trim());
  if (/^0x0{40}$/i.test(a))
    throw Error("The recipient cannot be the zero address.");
  return a;
}
export function fee(principal: bigint, bps: number, tier: number) {
  const base = (principal * BigInt(bps) + 9999n) / 10000n;
  const discount = [0, 2000, 3333, 5000][tier];
  if (discount === undefined) throw Error("Unknown lock tier");
  return (base * BigInt(10000 - discount) + 9999n) / 10000n;
}
export function swapPayload(
  key: PoolKey,
  zeroForOne: boolean,
  amountIn: bigint,
  minOut: bigint,
  extended = false,
) {
  const type = `((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,${extended ? "uint256 minHopPriceX36," : ""}bytes hookData)`;
  const params = encodeAbiParameters(parseAbiParameters(type), [
    {
      poolKey: key,
      zeroForOne,
      amountIn,
      amountOutMinimum: minOut,
      ...(extended ? { minHopPriceX36: 0n } : {}),
      hookData: "0x",
    },
  ]);
  const input = zeroForOne ? key.currency0 : key.currency1,
    output = zeroForOne ? key.currency1 : key.currency0;
  return encodeAbiParameters(parseAbiParameters("bytes,bytes[]"), [
    "0x060c0f",
    [
      params,
      encodeAbiParameters(parseAbiParameters("address,uint256"), [
        input,
        amountIn,
      ]),
      encodeAbiParameters(parseAbiParameters("address,uint256"), [
        output,
        minOut,
      ]),
    ],
  ]);
}
export function slippage(s: string) {
  const clean = s.trim();
  const message = "Use slippage from 0.05% to 5%, with at most two decimals.";
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(clean)) throw Error(message);
  const bps = parseUnits(clean, 2);
  if (bps < 5n || bps > 500n) throw Error(message);
  return bps;
}
export async function switchChain(provider: Provider, d: Deployment) {
  const chainId = `0x${d.chainId.toString(16)}`;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  } catch (e: any) {
    if (
      e.code !== 4902 &&
      !/unknown chain|unrecognized chain|not added/i.test(e.message ?? "")
    )
      throw e;
    if (!d.walletAddChain)
      throw Error("This network has no approved wallet setup parameters.");
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [d.walletAddChain],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  }
}
export function parseInput(p: AbiParameter, value: any): any {
  if (p.type === "tuple") {
    const x = typeof value === "string" ? JSON.parse(value) : value;
    if (!x || typeof x !== "object")
      throw Error(`${p.name}: paste a JSON object.`);
    return Object.fromEntries(
      ("components" in p ? p.components : []).map((c) => [
        c.name,
        parseInput(c, x[c.name!]),
      ]),
    );
  }
  if (p.type === "address") return address(String(value));
  if (p.type === "bool") {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    throw Error(`${p.name}: choose true or false.`);
  }
  if (p.type.startsWith("uint")) {
    if (typeof value === "number" && !Number.isSafeInteger(value))
      throw Error(`${p.name}: quote large integers in JSON.`);
    const n = uint(String(value));
    const bits = Number(p.type.slice(4) || 256);
    if (n >= 2n ** BigInt(bits))
      throw Error(`${p.name}: value exceeds ${p.type}.`);
    return bits <= 48 ? Number(n) : n;
  }
  if (p.type.startsWith("bytes")) {
    const s = String(value).trim();
    const size = Number(p.type.slice(5));
    if (!/^0x([0-9a-fA-F]{2})*$/.test(s) || (size && s.length !== 2 + size * 2))
      throw Error(
        `${p.name}: enter ${size || "an even number of"} bytes as 0x hex.`,
      );
    return s as Hex;
  }
  if (p.type === "string" && typeof value === "string") return value;
  throw Error(`Unsupported or missing field: ${p.name}`);
}
const errors: Record<string, string> = {
  Paused: "New borrowing is paused. Repayment and claims remain available.",
  StaleFloor:
    "The floor is stale. Submit a fresh signed floor before borrowing or extending.",
  NotConfigured:
    "The oracle question is not configured. The setup authority must set it first.",
  InsufficientIdle:
    "The pool has insufficient idle ETH. Reduce the amount or wait for repayments.",
  CapExceeded:
    "This deposit exceeds the remaining pool cap. Reduce the amount.",
  Committed:
    "This PAWN is committed to an open loan. Repay first or unlock a smaller amount.",
  NothingToClaim: "There is no claimable ETH for this account.",
  Unauthorized: "This wallet is not authorized for this action.",
  GracePeriod: "The loan has not passed the required grace period.",
  TimelockPending:
    "This change is not executable yet, is missing, or has expired.",
  InvalidAttestation:
    "The signed attestation is invalid for this action. Check its question, domain, quorum and expiry.",
  IncorrectPayment:
    "The exact payment changed. Refresh and review the action again.",
  ShareExceeded: "This collection has reached its borrowing allocation.",
  MilestoneNotReached: "The signed market cap is below the burn milestone.",
  CollectionDisabled: "New borrowing is disabled for this collection or term.",
  AlreadyBurned: "The one-time burn has already completed.",
  ForbiddenTarget: "This target is not permitted for vault calls.",
  InvalidAuthorization:
    "Check the pairing message, vault address, token ID and expiry.",
  InsufficientFundsError:
    "Your wallet needs more ETH for this payment and gas.",
};
export function friendlyError(e: any): string {
  let x = e;
  for (let i = 0; x && i < 8; i++, x = x.cause) {
    if (x.code === 4001 || /user rejected|user denied/i.test(x.message ?? ""))
      return "Request rejected in your wallet. You can try again.";
    if (errors[x.data?.errorName]) return errors[x.data.errorName];
    if (errors[x.name]) return errors[x.name];
  }
  for (const [name, msg] of Object.entries(errors))
    if (String(e?.message).includes(name)) return msg;
  return (
    e?.shortMessage ||
    e?.message ||
    "The request failed. Check your connection and try again."
  );
}
