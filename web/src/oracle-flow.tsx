import { useEffect, useRef, useState } from "react";
import { type Address, type Hex } from "viem";
import { useEngine, read } from "./engine";
import { erc20, walletClient } from "./config";
import { Action, Field, Notice, Pair, units } from "./components";
import {
  API,
  apiJSON,
  encodePaymentHeader,
  checkChallenge,
  loadEvidence,
  oracleInput,
  PAYMENT_PROXY,
  signPayment,
  validateEvidence,
  zeroHash,
  type Kind,
} from "./oracle";
export function OracleFlow({
  kind = "floor",
  publicFlow = false,
}: {
  kind?: Kind;
  publicFlow?: boolean;
}) {
  const e = useEngine(),
    r = e.runtime,
    s = e.snapshot;
  const [id, setId] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [evidence, setEvidence] = useState<any>(),
    [cap, setCap] = useState<bigint>();
  const active = useRef(true),
    cancel = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      cancel.current = true;
    };
  }, []);
  const storageKey = `pawn-oracle-${e.account}-${kind}`;
  useEffect(() => {
    setId(localStorage.getItem(storageKey + "-id") ?? "");
    setEvidence(undefined);
    setCap(undefined);
  }, [storageKey]);
  useEffect(() => {
    if (kind !== "cap" || !r || !s) return;
    let live = true;
    async function latest() {
      try {
        const list = await apiJSON("/oracle/requests?limit=100");
        for (const item of list.requests.filter(
          (item: any) =>
            item.question ===
            oracleInput(
              "cap",
              r!.contracts.MilestoneBurn.address,
              r!.deployment.poolKey,
            ).question,
        )) {
          try {
            const ev = await loadEvidence(item.id);
            if (!ev) continue;
            const valid = await checked(ev);
            if (live) {
              setEvidence(ev);
              setCap(valid.value);
            }
            return;
          } catch {
            /* Skip foreign consumer, incompatible hash or expired evidence. */
          }
        }
      } catch {
        /* A request id can still be supplied manually. */
      }
    }
    if (evidence)
      checked(evidence)
        .then((v) => {
          if (live) setCap(v.value);
        })
        .catch(() => {
          if (live) {
            setEvidence(undefined);
            setCap(undefined);
          }
        });
    else void latest();
    return () => {
      live = false;
    };
  }, [kind, s?.at]);
  async function walletCheck() {
    if (!e.ready || !r || !s || !e.account || !window.ethereum)
      throw Error("Connect a wallet on Ethereum and refresh chain state.");
    const accounts = await window.ethereum.request({ method: "eth_accounts" }),
      chain = await window.ethereum.request({ method: "eth_chainId" });
    if (
      accounts[0]?.toLowerCase() !== e.account.toLowerCase() ||
      Number(chain) !== 1 ||
      !active.current ||
      cancel.current
    )
      throw Error(
        "Wallet changed or flow cancelled. Resume with your request id.",
      );
    return walletClient(r, window.ethereum, e.account);
  }
  function update(text: string) {
    if (active.current) setStatus(text);
  }
  async function checked(ev: any) {
    const consumer =
      kind === "floor" ? r!.contracts.PawnShop : r!.contracts.MilestoneBurn;
    const [block, signer, pinned] = await Promise.all([
      r!.client.getBlock(),
      read(r!, r!.contracts.PawnShop, "oracleSigner"),
      kind === "floor"
        ? read(r!, r!.contracts.PawnShop, "collections", [
            s!.collectionAddress,
          ]).then((x) => x[5])
        : read(r!, consumer, "questionHash"),
    ]);
    return validateEvidence(
      ev,
      kind,
      consumer.address,
      signer,
      pinned,
      Number(block.timestamp),
    );
  }
  async function post(ev: any) {
    const valid = await checked(ev);
    if (!active.current || cancel.current) return;
    setEvidence(ev);
    if (kind === "cap") setCap(valid.value);
    const c =
      kind === "floor" ? r!.contracts.PawnShop : r!.contracts.MilestoneBurn;
    const pinned =
      kind === "floor"
        ? (await read(r!, c, "collections", [s!.collectionAddress]))[5]
        : await read(r!, c, "questionHash");
    if (pinned === zeroHash) {
      const authority = await read(
        r!,
        c,
        kind === "floor" ? "owner" : "questionSetter",
      );
      if (authority.toLowerCase() !== e.account?.toLowerCase())
        throw Error(
          "The question is unset. Its owner/setup authority must configure it first; retain this request id.",
        );
      await walletCheck();
      update("Confirm the one-time question hash in your wallet.");
      await e.send(
        {
          contract: c,
          functionName: "setQuestionHashOnce",
          args:
            kind === "floor"
              ? [s!.collectionAddress, valid.attestation.questionHash]
              : [valid.attestation.questionHash],
          summary: "Pin the verified oracle question hash.",
        },
        () => {},
      );
    }
    if (kind === "floor") {
      const floor = await read(r!, c, "floors", [s!.collectionAddress]);
      if (valid.attestation.issuedAt <= floor[1]) {
        update("Done: this floor or a newer one is already stored.");
        return;
      }
      await walletCheck();
      const fresh = await checked(ev);
      update("Confirm posting the verified floor in your wallet.");
      await e.send(
        {
          contract: c,
          functionName: "submitFloor",
          args: [s!.collectionAddress, fresh.attestation, fresh.signature],
          summary: `Post ${units(fresh.value)} ETH floor.`,
        },
        () => {},
      );
      update("Done: floor posted and chain state refreshed.");
    } else
      update(
        valid.value >= 1000000n * 10n ** 18n
          ? "Market cap verified. The milestone qualifies; review Burn below."
          : "Market cap verified. The $1M milestone has not been reached.",
      );
  }
  async function poll(requestId: string) {
    localStorage.setItem(storageKey + "-id", requestId);
    setId(requestId);
    while (active.current && !cancel.current) {
      update(`Request ${requestId}: waiting for the oracle panel…`);
      const ev = await loadEvidence(requestId);
      if (ev) {
        await post(ev);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }
  async function buy() {
    if (
      (kind === "floor" ? s?.collection[5] : s?.burn.questionHash) === zeroHash
    ) {
      const authority =
        kind === "floor" ? s?.shop.owner : s?.burn.questionSetter;
      if (authority?.toLowerCase() !== e.account?.toLowerCase())
        throw Error(
          "The setup authority must configure this question before you purchase a refresh.",
        );
    }
    const wallet = await walletCheck(),
      asset = r!.deployment.network.pairToken.address,
      permit = r!.deployment.network.uniswapV4.permit2;
    let saved = JSON.parse(
      localStorage.getItem(storageKey + "-order") ?? "null",
    );
    const input = oracleInput(
      kind,
      (kind === "floor" ? r!.contracts.PawnShop : r!.contracts.MilestoneBurn)
        .address,
      r!.deployment.poolKey,
    );
    if (!saved) {
      const token = Array.from(
        crypto.getRandomValues(new Uint8Array(32)),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      saved = { token, key: crypto.randomUUID() };
      localStorage.setItem(storageKey + "-order", JSON.stringify(saved));
    }
    const headers = {
      Authorization: `Bearer ${saved.token}`,
      "Content-Type": "application/json",
    };
    if (!saved.orderId) {
      update("Getting the 0.5 IMD quote…");
      const quote = await apiJSON("/requests/quote", {
        method: "POST",
        headers,
        body: JSON.stringify({
          requestKey: saved.key,
          action: "oracle.request",
          input,
        }),
      });
      saved.orderId = quote.order.id;
      localStorage.setItem(storageKey + "-order", JSON.stringify(saved));
    }
    let outcome = await apiJSON(`/requests/${saved.orderId}`, { headers });
    if (["expired", "payment_failed"].includes(outcome.status))
      throw Error(
        `Order ${saved.orderId}: ${outcome.status}. Clear the unpaid order before retrying.`,
      );
    if (outcome.status === "quoted") {
      if (!saved.payment) {
        const policy = (await apiJSON("/requests/capabilities")).actions.find(
          (p: any) => p.action === "oracle.request",
        );
        const ch = await apiJSON(`/requests/${saved.orderId}/submit`, {
          method: "POST",
          headers,
        });
        const req = checkChallenge(
          ch,
          input,
          policy,
          asset,
          Math.floor(Date.now() / 1000),
        );
        for (const address of [permit, PAYMENT_PROXY])
          if (
            !(await r!.client.getCode({ address })) ||
            (await r!.client.getCode({ address })) === "0x"
          )
            throw Error("Payment contract code unavailable.");
        const tokenContract = { name: "IMD", address: asset, abi: erc20 };
        if (
          (await read(r!, tokenContract, "balanceOf", [e.account])) <
          500000000000000000n
        )
          throw Error("Your wallet needs at least 0.5 IMD.");
        if (
          (await read(r!, tokenContract, "allowance", [e.account, permit])) <
          500000000000000000n
        ) {
          update("Confirm approval of exactly 0.5 IMD to Permit2.");
          await walletCheck();
          await e.send(
            {
              contract: tokenContract,
              functionName: "approve",
              args: [permit, 500000000000000000n],
              summary: "Approve 0.5 IMD for this oracle payment.",
            },
            () => {},
          );
        }
        const nonce = BigInt(
          "0x" +
            Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
              b.toString(16).padStart(2, "0"),
            ).join(""),
        );
        update("Sign the 0.5 IMD Permit2 payment, then its quote approval.");
        const signed = await signPayment(
          ch,
          req,
          e.account!,
          permit,
          async (data) => {
            await walletCheck();
            return wallet.signTypedData(data);
          },
          nonce,
          Math.floor(Date.now() / 1000),
        );
        saved.payment = signed;
        localStorage.setItem(storageKey + "-order", JSON.stringify(saved));
      }
      await walletCheck();
      update("Submitting payment; retries reuse this order.");
      outcome = await apiJSON(`/requests/${saved.orderId}/submit`, {
        method: "POST",
        headers: {
          ...headers,
          "PAYMENT-SIGNATURE": encodePaymentHeader(saved.payment.payment),
        },
        body: JSON.stringify({ quoteSignature: saved.payment.quoteSignature }),
      });
    }
    while (outcome.status !== "admitted") {
      if (
        ["expired", "payment_failed"].includes(outcome.status) ||
        outcome.error
      )
        throw Error(
          `Payment failed: ${outcome.detail ?? outcome.error ?? outcome.status}. Retain order ${saved.orderId}.`,
        );
      await walletCheck();
      update(`Order ${saved.orderId}: ${outcome.status}…`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      outcome = await apiJSON(`/requests/${saved.orderId}`, { headers });
    }
    const result = outcome.admission?.result;
    if (result?.kind !== "oracle" || !result.requestId)
      throw Error(
        `Paid order was refused: ${JSON.stringify(result)}. Retain order ${saved.orderId}; do not pay again.`,
      );
    localStorage.removeItem(storageKey + "-order");
    await poll(result.requestId);
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    cancel.current = false;
    try {
      await fn();
    } catch (x) {
      if (active.current) setError(x instanceof Error ? x.message : String(x));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <section
      className="oracle-flow"
      aria-label={kind === "floor" ? "Refresh floor" : "Market cap request"}
    >
      <p>
        Public-source panel · within 5% · uint256 · Ethereum. Oracle request:
        0.5 IMD; posting uses ETH gas.
      </p>
      <button
        disabled={!e.ready || e.pending || busy}
        onClick={() => void run(buy)}
      >
        {publicFlow
          ? "Refresh floor"
          : kind === "floor"
            ? "Request floor"
            : "Request market cap"}
      </button>
      <Field
        label={`${kind === "floor" ? "Floor" : "Market cap"} request id`}
        value={id}
        onChange={(v) => {
          setId(v.trim());
          setEvidence(undefined);
          setCap(undefined);
        }}
        hint="Paste a request UUID bought elsewhere, or resume your saved request."
      />
      <button
        disabled={!e.ready || e.pending || busy || !id}
        onClick={() => void run(() => poll(id))}
      >
        Use request id
      </button>
      {busy && (
        <button
          onClick={() => {
            cancel.current = true;
            update("Stopped waiting. Resume using the saved request id.");
          }}
        >
          Stop waiting
        </button>
      )}
      <button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const saved = JSON.parse(
              localStorage.getItem(storageKey + "-order") ?? "null",
            );
            if (saved?.orderId) {
              const state = await apiJSON(`/requests/${saved.orderId}`, {
                headers: { Authorization: `Bearer ${saved.token}` },
              });
              if (!["expired", "payment_failed"].includes(state.status))
                throw Error(
                  "Order is still active or paid. Resume it to avoid paying twice.",
                );
            }
            localStorage.removeItem(storageKey + "-order");
            update("Unpaid order cleared.");
          })
        }
      >
        Clear expired unpaid order
      </button>
      {status && (
        <Notice>
          <span role="status">{status}</span>
        </Notice>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {kind === "cap" && (
        <>
          <Pair label="Latest verified market cap">
            {cap === undefined
              ? "Pending evidence"
              : `$${units(cap)} / $1,000,000`}
          </Pair>
          <Action
            label="Burn"
            disabled={
              !evidence ||
              cap === undefined ||
              cap < 1000000n * 10n ** 18n ||
              !s?.burn.balance ||
              s?.burn.burned
            }
            prepare={async () => {
              const valid = await checked(evidence);
              return {
                contract: r!.contracts.MilestoneBurn,
                functionName: "burn",
                args: [valid.attestation, valid.signature],
                summary: `Irreversibly burn the entire ${units(s?.burn.balance)} PAWN vault.`,
              };
            }}
          />
        </>
      )}
    </section>
  );
}
