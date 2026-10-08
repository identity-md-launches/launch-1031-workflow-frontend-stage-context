import { useEffect, useRef, useState } from "react";
import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  type Address,
} from "viem";
import { useEngine, read, verifyCode } from "./engine";
import { erc20, native, permit2, quoter, router, stateView } from "./config";
import { amount, slippage, swapPayload, friendlyError } from "./logic";
import {
  Action,
  AddressLink,
  Field,
  Notice,
  Pair,
  Panel,
  units,
} from "./components";
type Quote = {
  amountIn: bigint;
  amountOut: bigint;
  minOut: bigint;
  time: number;
  zeroForOne: boolean;
  input: Address;
  output: Address;
  inputSymbol: string;
  outputSymbol: string;
  inDecimals: number;
  outDecimals: number;
  impact: number;
};
export function Trade() {
  const e = useEngine(),
    r = e.runtime,
    s = e.snapshot;
  const [side, setSide] = useState("buy"),
    [v, setV] = useState(""),
    [slip, setSlip] = useState("0.50"),
    [q, setQ] = useState<Quote>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [allowance, setAllowance] = useState<{
      token: bigint;
      router: bigint;
      expiry: number;
    }>(),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const quoteGeneration = useRef(0);
  useEffect(() => {
    quoteGeneration.current++;
    setQ(undefined);
    setError("");
    setAllowance(undefined);
  }, [side, v, slip, e.account, e.chainId]);
  const token = r?.contracts.LaunchToken.address,
    key = r?.deployment.poolKey,
    network = r?.deployment.network;
  const paired =
    key && token
      ? key.currency0.toLowerCase() === token.toLowerCase()
        ? key.currency1
        : key.currency0
      : undefined;
  const pairMeta =
    paired === native
      ? { symbol: "ETH", decimals: 18 }
      : network?.pairToken.address.toLowerCase() === paired?.toLowerCase()
        ? network!.pairToken
        : network?.otherPairTokens?.find(
            (t) => t.address.toLowerCase() === paired?.toLowerCase(),
          );
  const inSymbol = side === "buy" ? (pairMeta?.symbol ?? "Pair token") : "PAWN",
    outSymbol = side === "buy" ? "PAWN" : (pairMeta?.symbol ?? "Pair token");
  async function approvals() {
    setAllowance(undefined);
    if (!r || !q || !e.account) return;
    if (q.input === native) {
      setAllowance({
        token: q.amountIn,
        router: q.amountIn,
        expiry: Math.floor(Date.now() / 1000) + 1000,
      });
      return;
    }
    const u = r.deployment.network.uniswapV4;
    const [a, b] = await Promise.all([
      read(
        r,
        { name: "Input token", address: q.input, abi: erc20 },
        "allowance",
        [e.account, u.permit2],
      ),
      read(
        r,
        { name: "Permit2", address: u.permit2, abi: permit2 },
        "allowance",
        [e.account, q.input, u.universalRouter],
      ),
    ]);
    setAllowance({ token: a, router: b[0], expiry: Number(b[1]) });
  }
  useEffect(() => {
    void approvals().catch((x) => setError(friendlyError(x)));
  }, [q, s?.at, e.account]);
  async function quote() {
    const revision = ++quoteGeneration.current;
    setBusy(true);
    setError("");
    setQ(undefined);
    try {
      if (!r || !key || !network?.uniswapV4 || !s || !pairMeta)
        throw Error(
          "Trading requires a verified deployment and a supported pair from the network configuration.",
        );
      const input = side === "buy" ? paired! : token!,
        output = side === "buy" ? token! : paired!;
      const inDecimals = side === "buy" ? pairMeta.decimals : s.token.decimals,
        outDecimals = side === "buy" ? s.token.decimals : pairMeta.decimals;
      const n = amount(v, inDecimals);
      if (n >= 1n << 128n) throw Error("Amount exceeds the router limit.");
      const bps = slippage(slip);
      const u = network.uniswapV4;
      await verifyCode(r, [
        u.quoter,
        u.universalRouter,
        u.permit2,
        u.stateView,
        u.poolManager,
      ]);
      const poolId = keccak256(
        encodeAbiParameters(
          parseAbiParameters(
            "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
          ),
          [key],
        ),
      );
      const view = {
        name: "Uniswap pool state",
        address: u.stateView,
        abi: stateView,
      };
      const [slot, liquidity] = await Promise.all([
        read(r, view, "getSlot0", [poolId]),
        read(r, view, "getLiquidity", [poolId]),
      ]);
      if (!slot[0] || !liquidity)
        throw Error(
          "This pool has no active liquidity. Trading is unavailable until liquidity is added.",
        );
      const zeroForOne = input.toLowerCase() === key.currency0.toLowerCase();
      const result = await r.client.simulateContract({
        address: u.quoter,
        abi: quoter,
        functionName: "quoteExactInputSingle",
        args: [{ poolKey: key, zeroForOne, exactAmount: n, hookData: "0x" }],
      });
      const outputAmount = result.result[0];
      const min = (outputAmount * (10000n - bps)) / 10000n;
      if (!min || min >= 1n << 128n)
        throw Error("The quoted output is zero or exceeds the router limit.");
      const sqrt = BigInt(slot[0]);
      const sq = sqrt * sqrt;
      const spot = zeroForOne
        ? (n * sq) / (1n << 192n)
        : (n * (1n << 192n)) / sq;
      const impact = spot
        ? Number(((spot - outputAmount) * 10000n) / spot) / 100
        : 0;
      if (revision !== quoteGeneration.current) return;
      setQ({
        amountIn: n,
        amountOut: outputAmount,
        minOut: min,
        time: Date.now(),
        zeroForOne,
        input,
        output,
        inputSymbol: inSymbol,
        outputSymbol: outSymbol,
        inDecimals,
        outDecimals,
        impact,
      });
    } catch (x) {
      setError(friendlyError(x));
    } finally {
      setBusy(false);
    }
  }
  const stale = !!q && now - q.time > 60000;
  const step =
    q?.input === native
      ? "swap"
      : allowance && q
        ? allowance.token < q.amountIn
          ? "token"
          : allowance.router < q.amountIn ||
              allowance.expiry < Math.floor(now / 1000) + 60
            ? "permit"
            : "swap"
        : undefined;
  return (
    <div className="workspace-grid">
      <Panel kicker="05 / Trade" title="A place for PAWN.">
        <div className="segmented" aria-label="Trade direction">
          <button aria-pressed={side === "buy"} onClick={() => setSide("buy")}>
            Buy PAWN
          </button>
          <button
            aria-pressed={side === "sell"}
            onClick={() => setSide("sell")}
          >
            Sell PAWN
          </button>
        </div>
        <Field
          label={`You pay (${inSymbol})`}
          value={v}
          onChange={setV}
          type="number"
        />
        <Field
          label="Slippage tolerance (%)"
          value={slip}
          onChange={setSlip}
          type="number"
          hint="0.05%–5%. Default 0.50%. Quotes expire after 60 seconds."
        />
        <button onClick={quote} disabled={busy || !s}>
          {busy ? "Fetching quote…" : "Get quote"}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {q && (
          <>
            <div className="receipt">
              <Pair label="Estimated received">
                {units(q.amountOut, q.outDecimals)} {outSymbol}
              </Pair>
              <Pair label="Minimum received">
                {units(q.minOut, q.outDecimals)} {outSymbol}
              </Pair>
              <Pair label="Rate">
                1 {inSymbol} ≈{" "}
                {units(
                  (q.amountOut * 10n ** BigInt(q.inDecimals)) / q.amountIn,
                  q.outDecimals,
                )}{" "}
                {outSymbol}
              </Pair>
              <Pair label="Price difference incl. fees">
                {q.impact.toFixed(2)}%
              </Pair>
              <Pair label="Quote age">
                {Math.floor((now - q.time) / 1000)} seconds
              </Pair>
            </div>
            {stale && (
              <Notice tone="warning">
                Quote expired. Get a fresh quote to continue.
              </Notice>
            )}
            {q.impact > 5 && (
              <Notice tone="warning">
                High price difference. This trade returns over 5% less than the
                pool’s spot rate before fees.
              </Notice>
            )}
            <Action
              key={`${q.time}-${step}`}
              label={
                step === "token"
                  ? `Approve ${inSymbol} to Permit2`
                  : step === "permit"
                    ? `Approve router in Permit2`
                    : side === "buy"
                      ? "Buy PAWN"
                      : "Sell PAWN"
              }
              primary
              disabled={stale || !step}
              reason={
                !step
                  ? "Connect your wallet to check approvals."
                  : step === "token"
                    ? "Step 1 of 3: allow Permit2 to use this exact input amount."
                    : step === "permit"
                      ? "Step 2 of 3: allow the router to spend through Permit2 for 30 minutes."
                      : "Final step: simulate and execute the swap."
              }
              prepare={async () => {
                if (!r || !e.account || !q) throw Error("Connect first.");
                if (Date.now() - q.time > 60000)
                  throw Error("Quote expired. Get a fresh quote.");
                const u = r.deployment.network.uniswapV4;
                const balance =
                  q.input === native
                    ? await r.client.getBalance({ address: e.account })
                    : await read(
                        r,
                        { name: "Input token", address: q.input, abi: erc20 },
                        "balanceOf",
                        [e.account],
                      );
                if (q.amountIn > balance)
                  throw Error(
                    "Amount exceeds your input balance. Keep ETH available for gas.",
                  );
                if (step === "token")
                  return {
                    contract: { name: inSymbol, address: q.input, abi: erc20 },
                    functionName: "approve",
                    args: [u.permit2, q.amountIn],
                    summary: `Approve exactly ${units(q.amountIn, q.inDecimals)} ${inSymbol} to Permit2. This does not execute a swap.`,
                  };
                if (step === "permit")
                  return {
                    contract: {
                      name: "Permit2",
                      address: u.permit2,
                      abi: permit2,
                    },
                    functionName: "approve",
                    args: [
                      q.input,
                      u.universalRouter,
                      q.amountIn,
                      Math.floor(Date.now() / 1000) + 1800,
                    ],
                    summary: `Allow Universal Router to use exactly ${units(q.amountIn, q.inDecimals)} ${inSymbol} through Permit2, expiring in 30 minutes.`,
                  };
                return {
                  contract: {
                    name: "Universal Router",
                    address: u.universalRouter,
                    abi: router,
                  },
                  functionName: "execute",
                  args: [
                    "0x10",
                    [
                      swapPayload(
                        key!,
                        q.zeroForOne,
                        q.amountIn,
                        q.minOut,
                        !!u.extendedSwapParams,
                      ),
                    ],
                    BigInt(Math.floor(Date.now() / 1000) + 300),
                  ],
                  value: q.input === native ? q.amountIn : 0n,
                  expiresAt: q.time + 60000,
                  summary: `Swap ${units(q.amountIn, q.inDecimals)} ${inSymbol} for at least ${units(q.minOut, q.outDecimals)} ${outSymbol}. Slippage ${slip}%; transaction deadline 5 minutes. Review the price and network fee before confirming.`,
                };
              }}
            />
          </>
        )}
      </Panel>
      <Panel title="Know what you’re trading">
        <p>
          PAWN locks reduce the upfront fee on a seat loan. Trading is optional;
          borrowing and lending settle in ETH.
        </p>
        <Pair label="Market">{pairMeta?.symbol ?? "—"} / PAWN</Pair>
        <Pair label="Attested pool fee">
          {key ? `${key.fee / 10000}%` : "—"}
        </Pair>
        <Pair label="Pool tick spacing">{key?.tickSpacing ?? "—"}</Pair>
        <p>
          This interface quotes and simulates the exact pool in the deployment
          handoff. Low liquidity can cause large price changes or failed quotes.
        </p>
        <Notice>
          USD pricing is unavailable. No approved live USD price source is
          configured.
        </Notice>
        {network && (
          <>
            <AddressLink
              value={network.uniswapV4.universalRouter}
              label="Universal Router"
            />
            <br />
            <AddressLink value={network.uniswapV4.permit2} label="Permit2" />
            <br />
            <AddressLink value={key?.hooks} label="Pool initialization guard" />
          </>
        )}
        <p className="muted">
          Token sales require two explicit approvals only when allowances are
          short. Native ETH purchases require none.
        </p>
      </Panel>
    </div>
  );
}
