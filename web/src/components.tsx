import { useId, useState, type ReactNode } from "react";
import { formatUnits, getAddress, type Address, type Hex } from "viem";
import { useEngine, type Tx } from "./engine";
import { friendlyError } from "./logic";
export function units(n: bigint | undefined, decimals = 18, max = 6) {
  if (n === undefined) return "—";
  const s = formatUnits(n, decimals);
  const [a, b] = s.split(".");
  return (
    Number(a).toLocaleString("en-US") +
    (b ? "." + b.slice(0, max).replace(/0+$/, "") : "").replace(/\.$/, "")
  );
}
export function when(n: bigint | number | undefined) {
  return n
    ? new Date(Number(n) * 1000).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not set";
}
export function AddressLink({
  value,
  label,
}: {
  value?: Address;
  label?: string;
}) {
  const { runtime } = useEngine();
  const [copied, setCopied] = useState(false);
  if (!value) return <span>Not available</span>;
  return (
    <span className="address">
      <a
        title={getAddress(value)}
        href={`${runtime?.deployment.network.explorer}/address/${value}`}
        target="_blank"
        rel="noreferrer"
      >
        {label ?? `${getAddress(value).slice(0, 6)}…${value.slice(-4)}`} ↗
      </a>
      <button
        className="copy"
        type="button"
        aria-label={`Copy ${label ?? "address"}`}
        title={getAddress(value)}
        onClick={() =>
          navigator.clipboard
            .writeText(getAddress(value))
            .then(() => setCopied(true))
            .catch(() => setCopied(false))
        }
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
export function Field({
  label,
  value,
  onChange,
  hint,
  type = "text",
  multiline = false,
  options,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  hint?: string;
  type?: string;
  multiline?: boolean;
  options?: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {options ? (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : multiline ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={hint ? id + "-hint" : undefined}
          spellCheck={false}
          rows={5}
        />
      ) : (
        <input
          id={id}
          type="text"
          inputMode={type === "number" ? "decimal" : "text"}
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={hint ? id + "-hint" : undefined}
        />
      )}
      {hint && <small id={id + "-hint"}>{hint}</small>}
    </div>
  );
}
export function Panel({
  title,
  kicker,
  children,
  className = "",
}: {
  title: string;
  kicker?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {kicker && <p className="eyebrow">{kicker}</p>}
      <h2>{title}</h2>
      {children}
    </section>
  );
}
export function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
export function Pair({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="pair">
      <span>{label}</span>
      <span>{children}</span>
    </div>
  );
}
export function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <div className={`notice ${tone}`}>{children}</div>;
}
export function Action({
  label,
  prepare,
  disabled,
  reason,
  primary = false,
}: {
  label: string;
  prepare: () => Promise<Tx> | Tx;
  disabled?: boolean;
  reason?: string;
  primary?: boolean;
}) {
  const e = useEngine();
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<Tx>();
  const [error, setError] = useState<string>();
  const [hash, setHash] = useState<Hex>();
  const [done, setDone] = useState(false);
  const [phase, setPhase] = useState("");
  async function review() {
    setBusy(true);
    setError(undefined);
    setHash(undefined);
    setDone(false);
    setPhase("Checking");
    try {
      const t = await prepare();
      await e.simulate(t);
      setTx(t);
    } catch (x) {
      setError(friendlyError(x));
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!tx) return;
    setBusy(true);
    setError(undefined);
    setPhase("Confirm in wallet");
    try {
      await e.send(tx, (h) => {
        setHash(h);
        setPhase("Waiting for confirmation");
      });
      setDone(true);
      setTx(undefined);
    } catch (x) {
      setError(friendlyError(x));
      setTx(undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="action">
      <button
        type="button"
        className={primary ? "primary" : ""}
        disabled={!e.ready || disabled || busy || e.pending}
        onClick={review}
      >
        {busy ? `${phase}…` : label}
      </button>
      {reason && <small>{reason}</small>}
      {tx && (
        <div className="review">
          <h3>Review transaction</h3>
          <p>{tx.summary}</p>
          <Pair label="Send">{units(tx.value ?? 0n)} ETH + network fee</Pair>
          <Pair label="Contract">
            <AddressLink value={tx.contract.address} label={tx.contract.name} />
          </Pair>
          <p className="muted">
            Simulation passed. Your wallet will show the final network fee.
          </p>
          <div className="button-row">
            <button
              type="button"
              className="primary"
              onClick={confirm}
              disabled={busy || e.pending || !e.ready || disabled}
            >
              Confirm {label.toLowerCase()}
            </button>
            <button
              type="button"
              onClick={() => setTx(undefined)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {hash && (
        <p role="status">
          <a
            target="_blank"
            rel="noreferrer"
            href={`${e.runtime?.deployment.network.explorer}/tx/${hash}`}
          >
            {done ? "Confirmed" : "Submitted"} transaction ↗
          </a>
        </p>
      )}
      {done && (
        <p className="success" role="status">
          {label} confirmed. Contract state refreshed.
        </p>
      )}
    </div>
  );
}
export function ReadButton({
  label,
  run,
}: {
  label: string;
  run: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="action">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await run();
          } catch (e) {
            setError(friendlyError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Loading…" : label}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
