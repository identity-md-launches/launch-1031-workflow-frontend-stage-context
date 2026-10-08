import { useEffect, useState } from "react";
import { encodeAbiParameters, getAddress, keccak256, parseAbiParameters, type Address } from "viem";
import { useEngine, read } from "./engine";
import { Action, AddressLink, Field, Notice, Pair, Panel } from "./components";
import { Countdown } from "./governance-state";
import { signerMode, isFloorRelay } from "./oracle";

export function RelayStatus() {
  const { runtime: r, snapshot: s } = useEngine();
  const [mode, setMode] = useState("");
  useEffect(() => {
    let live = true;
    setMode("");
    if (r && s) signerMode(r.client, s.shop.oracleSigner)
      .then((value) => { if (live) setMode(value); })
      .catch(() => { if (live) setMode("unknown"); });
    return () => { live = false; };
  }, [r, s?.shop.oracleSigner]);
  return <>
    <Pair label="Current attester"><AddressLink value={s?.shop.oracleSigner} /></Pair>
    {mode === "relay" ? <Notice>FloorRelay is active. Answers signed with no consumer are accepted.</Notice>
      : <Notice tone="warning">{mode === "unknown" ? "The current contract attester could not be verified as FloorRelay. Refresh state before posting." : "Until the FloorRelay switch lands, only answers signed for the contract are accepted."}</Notice>}
  </>;
}

export function RelaySwitch() {
  const e = useEngine(), r = e.runtime, s = e.snapshot;
  const owner = !!e.account && e.account.toLowerCase() === s?.shop.owner.toLowerCase();
  const [address, setAddress] = useState(() => localStorage.getItem("pawn-floor-relay") ?? "");
  const [at, setAt] = useState<bigint>();
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let live = true;
    setAt(undefined); setError("");
    if (!r || !address) return;
    async function load() {
      try {
        const target = getAddress(address);
        if (!isFloorRelay(await r!.client.getCode({ address: target }))) throw Error("Address must contain the exact reviewed FloorRelay runtime on Ethereum.");
        const op = keccak256(encodeAbiParameters(parseAbiParameters("string,address"), ["attester", target]));
        const value = await read(r!, r!.contracts.PawnShop, "queuedAt", [op]);
        if (live) { setAt(value); localStorage.setItem("pawn-floor-relay", target); }
      } catch (x) { if (live) setError(x instanceof Error ? x.message : String(x)); }
    }
    void load();
    return () => { live = false; };
  }, [r, s?.at, address]);
  async function target(): Promise<Address> {
    const value = getAddress(address);
    if (!isFloorRelay(await r!.client.getCode({ address: value }))) throw Error("FloorRelay runtime mismatch.");
    return value;
  }
  const switched = address.toLowerCase() === s?.shop.oracleSigner.toLowerCase();
  return <Panel title="FloorRelay attester">
    <RelayStatus />
    <Pair label="MilestoneBurn cached attester"><AddressLink value={s?.burn.oracleSigner} /></Pair>
    <p>MilestoneBurn follows PawnShop and syncs automatically on burn. The switch waits 48 hours, then must be executed within 7 days.</p>
    {owner && <>
      <Field label="Deployed FloorRelay address" value={address} onChange={setAddress} hint="Enter the mainnet deployment address supplied by the relay deployer. Its runtime is checked before queuing." />
      {error && <p role="alert">{error}</p>}
      <Action key={`queue-${address}`} label="Switch attester to FloorRelay" disabled={!r || at === undefined || (!!at && now <= Number(at) + 604800) || switched} prepare={async () => ({
        contract: r!.contracts.PawnShop, functionName: "queueAttester", args: [await target()],
        summary: "Queue FloorRelay as PawnShop’s attester. Execute after 48 hours; MilestoneBurn follows this switch.",
      })} />
      <Action key={`execute-${address}`} label="Execute FloorRelay switch" disabled={!at || now < Number(at) || now > Number(at) + 604800 || switched} prepare={async () => ({
        contract: r!.contracts.PawnShop, functionName: "executeAttester", args: [await target()],
        summary: "Activate the queued FloorRelay for PawnShop and subsequent MilestoneBurn calls.",
      })} />
    </>}
    {!!at && <Pair label="FloorRelay switch countdown"><Countdown at={at} expires={at + 604800n} /></Pair>}
  </Panel>;
}
