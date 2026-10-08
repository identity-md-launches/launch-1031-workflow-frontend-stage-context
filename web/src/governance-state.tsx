import { useEffect, useRef, useState } from "react";
import { parseAbiItem, type Hex } from "viem";
import deployment from "../deployment.json";
import { useEngine, read } from "./engine";
import { Notice, Pair, when } from "./components";

const queuedEvent = parseAbiItem(
  "event ChangeQueued(bytes32 indexed operation, uint256 executableAt)",
);
const firstBlock = BigInt(
  deployment.contracts.find((c) => c.name === "PawnShop")!.blockNumber,
);

export function countdown(at: bigint, now: number, expires?: bigint) {
  const seconds = Number(at) - now;
  const duration = (n: number) =>
    `${Math.floor(n / 86400)}d ${Math.floor((n % 86400) / 3600)}h ${Math.floor((n % 3600) / 60)}m ${n % 60}s`;
  if (seconds > 0) return `Ready in ${duration(seconds)}`;
  if (expires !== undefined) {
    if (now > Number(expires)) return "Expired — must be queued again";
    return `Ready · expires in ${duration(Number(expires) - now)}`;
  }
  return "Ready to apply";
}

export function Countdown({ at, expires }: { at: bigint; expires?: bigint }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);
  // No live region: a ticking clock should not interrupt a screen reader.
  return <span>{countdown(at, now, expires)}</span>;
}

export function QueuedChanges() {
  const { runtime: r, snapshot: s } = useEngine();
  const [changes, setChanges] = useState<{ operation: Hex; at: bigint }[]>();
  const [error, setError] = useState(false);
  const cache = useRef({ next: firstBlock, operations: new Set<Hex>() });
  useEffect(() => {
    if (!r || !s) return;
    let active = true;
    const current = cache.current;
    async function load() {
      try {
        // Enumerate every queued hash, including collections outside the seat.
        // Re-read the last chunk on refresh for shallow reorgs; storage below
        // filters executed, cancelled and superseded operations.
        let from =
          current.next > firstBlock + 2000n ? current.next - 2000n : firstBlock;
        while (from <= s!.block) {
          const to = from + 1999n < s!.block ? from + 1999n : s!.block;
          const logs = await r!.client.getLogs({
            address: r!.contracts.PawnShop.address,
            event: queuedEvent,
            fromBlock: from,
            toBlock: to,
          });
          if (!active) return;
          for (const log of logs)
            if (log.args.operation) current.operations.add(log.args.operation);
          current.next = to + 1n;
          from = to + 1n;
        }
        const pending: { operation: Hex; at: bigint }[] = [];
        const operations = [...current.operations];
        for (let i = 0; i < operations.length; i += 20) {
          const batch = await Promise.all(
            operations.slice(i, i + 20).map(async (operation) => ({
              operation,
              at: (await read(r!, r!.contracts.PawnShop, "queuedAt", [
                operation,
              ])) as bigint,
            })),
          );
          if (!active) return;
          pending.push(...batch.filter((change) => change.at !== 0n));
        }
        if (active) {
          setChanges(pending.sort((a, b) => Number(a.at - b.at)));
          setError(false);
        }
      } catch {
        if (active) {
          setChanges(undefined);
          setError(true);
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [r, s?.at]);
  if (!s) return <p>Waiting for verified chain state…</p>;
  if (error)
    return (
      <Notice tone="warning">
        Queued changes could not be loaded. Use Refresh state to retry, or view
        governance events below.
      </Notice>
    );
  if (!changes) return <p role="status">Loading queued changes…</p>;
  if (!changes.length) return <p>No queued PawnShop changes.</p>;
  return (
    <>
      {changes.map(({ operation, at }) => (
        <div className="receipt" key={operation}>
          <Pair label="Operation">
            <span className="break">{operation}</span>
          </Pair>
          <Pair label="Countdown">
            <Countdown at={at} expires={at + 604800n} />
          </Pair>
          <Pair label="Executable after">{when(at)}</Pair>
          <Pair label="Expires">{when(at + 604800n)}</Pair>
        </div>
      ))}
    </>
  );
}
