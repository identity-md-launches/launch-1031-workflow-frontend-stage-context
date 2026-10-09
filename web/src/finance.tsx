import { OracleFlow } from "./oracle-flow";
import { useEffect, useRef, useState } from "react";
import { formatUnits, type Address } from "viem";
import { useEngine, read, type Tx } from "./engine";
import { erc20, erc721, type Contract } from "./config";
import { address, amount, uint } from "./logic";
import {
  Action,
  AddressLink,
  Field,
  Notice,
  Pair,
  Panel,
  ReadButton,
  units,
  when,
} from "./components";
export async function moduleFee(
  r: NonNullable<ReturnType<typeof useEngine>["runtime"]>,
  module: Contract,
  id: bigint,
  borrower: Address,
  principal: bigint,
  bps: number,
) {
  const base = (principal * BigInt(bps) + 9999n) / 10000n;
  const result = await r.client.simulateContract({
    address: module.address,
    abi: module.abi,
    functionName: "commit",
    args: [id, borrower, base],
    account: r.contracts.PawnShop.address,
  });
  const reduced = result.result as bigint;
  return reduced < base ? reduced : base;
}
export function Borrow() {
  const e = useEngine(),
    s = e.snapshot,
    r = e.runtime;
  const [id, setId] = useState(""),
    [term, setTerm] = useState("0");
  const [preview, setPreview] = useState<{
    approved: boolean;
    principal: bigint;
    fee: bigint;
    due: number;
    tier: number;
  }>();
  const inspection = useRef(0);
  async function inspect() {
    const revision = ++inspection.current;
    setPreview(undefined);
    if (!r || !s || !e.account)
      throw Error(
        "Connect your wallet and wait for live state before inspecting a seat.",
      );
    const tokenId = uint(id);
    const nft = {
      name: "Identity.md seat",
      address: s.collectionAddress,
      abi: erc721,
    };
    const [owner, approved, operator, price, tier] = await Promise.all([
      read(r, nft, "ownerOf", [tokenId]),
      read(r, nft, "getApproved", [tokenId]),
      read(r, nft, "isApprovedForAll", [
        e.account,
        r.contracts.PawnShop.address,
      ]),
      read(r, r.contracts.PawnShop, "floors", [s.collectionAddress]),
      read(r, s.lockContract, "tierOf", [e.account]),
    ]);
    if (owner.toLowerCase() !== e.account.toLowerCase())
      throw Error(
        "This seat is not held by your connected wallet. Check its token ID.",
      );
    const principal = (price[0] * BigInt(s.collection[Number(term)])) / 10000n;
    const f = await moduleFee(
      r,
      s.lockContract,
      s.shop.nextLoanId,
      e.account,
      principal,
      s.terms[Number(term)][1],
    );
    if (revision !== inspection.current) return;
    setPreview({
      approved:
        operator ||
        approved.toLowerCase() === r.contracts.PawnShop.address.toLowerCase(),
      principal,
      fee: f,
      due: Math.floor(Date.now() / 1000) + s.terms[Number(term)][0],
      tier,
    });
  }
  useEffect(() => {
    inspection.current++;
    setPreview(undefined);
  }, [id, term, e.account]);
  useEffect(() => {
    if (preview) void inspect().catch(() => setPreview(undefined));
  }, [s?.at]);
  const reason = !s
    ? "Waiting for verified contract state."
    : s.shop.newLoansPaused
      ? "New loans are paused by the owner."
      : !s.collection[4]
        ? "This collection is disabled."
        : s.collection[5] === `0x${"0".repeat(64)}`
          ? "The owner must configure the floor question."
          : !s.fresh
            ? "A fresh signed floor is required."
            : preview && preview.principal < 10000000000000000n
              ? "The available loan is below the 0.01 ETH minimum."
              : preview && preview.principal > s.pool.idleAssets
                ? "The pool needs more idle ETH."
                : preview &&
                    s.debt + preview.principal >
                      (s.pool.totalAssets * BigInt(s.collection[2])) / 10000n
                  ? "The collection borrowing allocation is full."
                  : !s.collection[Number(term)]
                    ? "This term is disabled for the collection."
                    : undefined;
  return (
    <div className="workspace-grid">
      <Panel kicker="01 / Borrow" title="Your seat. Still working.">
        <p>
          Borrow ETH against an identity.md seat while it stays active in the
          swarm.
        </p>
        {reason && <Notice tone="warning">{reason}</Notice>}
        <OracleFlow publicFlow />
        <Field
          label="Seat token ID"
          value={id}
          onChange={setId}
          type="number"
          hint="Enter the token ID held by your connected wallet."
        />
        <Field
          label="Loan term"
          value={term}
          onChange={setTerm}
          options={(
            s?.terms ?? [
              [2592000, 300],
              [604800, 100],
            ]
          ).map((t, i) => ({
            value: String(i),
            label: `${t[0] / 86400} days · ${t[1] / 100}% base fee${!s ? " (initial terms)" : ""}`,
          }))}
        />
        <ReadButton label="Inspect seat & loan" run={inspect} />
        {preview && (
          <>
            <div className="receipt">
              <Pair label="Principal to repay">
                {units(preview.principal)} ETH
              </Pair>
              <Pair label="Upfront fee">{units(preview.fee)} ETH</Pair>
              <Pair label="Available to claim">
                {units(preview.principal - preview.fee)} ETH
              </Pair>
              <Pair label="Estimated due date">{when(preview.due)}</Pair>
              <Pair label="Lock tier committed">{preview.tier}</Pair>
            </div>
            <Action
              key={`${id}-${term}-${preview.approved}-${s?.at}`}
              label={preview.approved ? "Pawn seat" : "Approve this seat"}
              primary
              disabled={!!reason}
              prepare={() =>
                preview.approved
                  ? {
                      contract: r!.contracts.PawnShop,
                      functionName: "pawn",
                      // Audit F6: displayed principal and fee with 1% tolerance.
                      args: [
                        s!.collectionAddress,
                        uint(id),
                        Number(term),
                        (preview.principal * 99n) / 100n,
                        (preview.fee * 101n + 99n) / 100n,
                      ],
                      summary: `Move seat #${id} into its loan vault. Borrow ${units(preview.principal)} ETH with ${units(preview.fee)} ETH deducted. The transaction reverts if the principal falls more than 1% or the fee rises more than 1% before it lands. Claim ${units(preview.principal - preview.fee)} ETH separately. Repay full principal before auction starts or lose the seat. Your tier PAWN stays committed while the loan is open.`,
                    }
                  : {
                      contract: {
                        name: "Identity.md seat",
                        address: s!.collectionAddress,
                        abi: erc721,
                      },
                      functionName: "approve",
                      args: [r!.contracts.PawnShop.address, uint(id)],
                      summary: `Allow PawnShop to transfer only seat #${id}. This is a separate approval; you will then review the loan.`,
                    }
              }
            />
          </>
        )}
        <p className="muted">
          Borrowed ETH becomes a pull credit. Use “Claim shop ETH” in Loans
          after confirmation.
        </p>
      </Panel>
      <div>
        <Panel
          kicker="Know your terms"
          title="A deadline, not a price trigger."
        >
          <ol className="steps">
            <li>
              <strong>Choose a term.</strong>
              <span>
                Borrow up to the collection’s limit against its attested floor.
              </span>
            </li>
            <li>
              <strong>Keep the seat working.</strong>
              <span>
                Register a worker pairing message in your loan’s vault.
              </span>
            </li>
            <li>
              <strong>Repay or extend.</strong>
              <span>
                After the due date and a 3-day grace period, anyone can start an
                auction.
              </span>
            </li>
          </ol>
          <p>
            There is no price-based liquidation. Missing your deadline can still
            cost you the seat.
          </p>
          <AddressLink
            value={s?.collectionAddress}
            label="Identity.md collection"
          />
        </Panel>
        <Panel title="Lower the fee with PAWN">
          <div className="tiers">
            <Pair label="1,000,000 PAWN">20% off</Pair>
            <Pair label="5,000,000 PAWN">33.33% off</Pair>
            <Pair label="20,000,000 PAWN">50% off</Pair>
          </div>
          <p>
            Lock before borrowing or extending. The largest tier commitment
            across your open loans remains locked.
          </p>
          <a href="#lock">Manage PAWN locks →</a>
        </Panel>
      </div>
    </div>
  );
}
export function Lend() {
  const e = useEngine(),
    s = e.snapshot;
  const [v, setV] = useState(""),
    [mode, setMode] = useState("deposit");
  const [preview, setPreview] = useState<string>();
  useEffect(() => setPreview(undefined), [v, mode]);
  return (
    <div className="workspace-grid">
      <Panel kicker="02 / Lend" title="Put ETH in the pool.">
        <p>
          Lenders share loan fees. Withdrawals depend on idle liquidity, and
          auction losses can reduce share value.
        </p>
        <Field
          label="Pool action"
          value={mode}
          onChange={setMode}
          options={[
            { value: "deposit", label: "Deposit ETH" },
            { value: "withdraw", label: "Withdraw ETH" },
            { value: "redeem", label: "Redeem pETH shares" },
            { value: "donate", label: "Donate ETH (no shares)" },
          ]}
        />
        <Field
          label={mode === "redeem" ? "pETH shares" : "Amount (ETH)"}
          value={v}
          onChange={setV}
          type="number"
        />
        <ReadButton
          label="Preview pool action"
          run={async () => {
            if (!s || !e.runtime || !e.account)
              throw Error("Connect a wallet and load pool state first.");
            const n = amount(
              v,
              mode === "redeem" ? Number(s.pool.decimals) : 18,
            );
            if (mode === "donate") {
              setPreview(
                `${units(n)} ETH donated, vesting over 7 days. You receive no shares.`,
              );
              return;
            }
            const fn =
              mode === "deposit"
                ? "previewDeposit"
                : mode === "withdraw"
                  ? "previewWithdraw"
                  : "previewRedeem";
            const out = await read(e.runtime, s.poolContract, fn, [n]);
            setPreview(
              mode === "redeem"
                ? `${units(out)} ETH becomes claimable.`
                : `${units(out, Number(s.pool.decimals))} pETH shares ${mode === "deposit" ? "minted" : "burned"}.`,
            );
          }}
        />
        {preview && <Notice>{preview}</Notice>}
        <Action
          key={`${mode}-${v}-${e.account}`}
          label={
            mode === "deposit"
              ? "Deposit ETH"
              : mode === "withdraw"
                ? "Withdraw ETH"
                : mode === "redeem"
                  ? "Redeem shares"
                  : "Donate ETH"
          }
          primary
          prepare={async () => {
            if (!s || !e.runtime || !e.account)
              throw Error("Load pool state first.");
            const n = amount(
              v,
              mode === "redeem" ? Number(s.pool.decimals) : 18,
            );
            const c = s.poolContract;
            if (mode === "deposit") {
              const max = await read(e.runtime, c, "maxDeposit", [e.account]);
              if (n > max)
                throw Error("Amount exceeds the remaining deposit cap.");
              const shares = await read(e.runtime, c, "previewDeposit", [n]);
              return {
                contract: c,
                functionName: "depositETH",
                args: [e.account],
                value: n,
                summary: `Deposit ${units(n)} ETH to mint approximately ${units(shares, Number(s.pool.decimals))} pETH shares to your wallet. Shares bear loan and liquidity risk.`,
              };
            }
            if (mode === "donate")
              return {
                contract: c,
                functionName: "donate",
                value: n,
                summary: `Permanently donate ${units(n)} ETH to lenders. Income vests over 7 days and no shares are issued.`,
              };
            const shares = mode === "redeem";
            const max = await read(
              e.runtime,
              c,
              shares ? "maxRedeem" : "maxWithdraw",
              [e.account],
            );
            if (n > max)
              throw Error(
                "Amount exceeds your available shares or idle pool liquidity.",
              );
            const assets = shares
              ? await read(e.runtime, c, "previewRedeem", [n])
              : n;
            return {
              contract: c,
              functionName: shares ? "redeemETH" : "withdrawETH",
              args: [n, e.account, e.account],
              summary: `Burn ${shares ? units(n, Number(s.pool.decimals)) + " pETH" : "the required shares"} for ${units(assets)} ETH. The ETH becomes claimable in LendingPool; claim it separately below.`,
            };
          }}
        />
      </Panel>
      <Panel title="Your lender position">
        <Pair label="pETH shares">
          {units(s?.pool.balanceOf, s?.pool.decimals ?? 24)}
        </Pair>
        <Pair label="Available to withdraw">
          {units(s?.pool.maxWithdraw)} ETH
        </Pair>
        <Pair label="Claimable pool ETH">{units(s?.pool.claimable)} ETH</Pair>
        <Action
          label="Claim pool ETH"
          disabled={!s?.pool.claimable}
          prepare={() => ({
            contract: s!.poolContract,
            functionName: "claim",
            args: [e.account],
            summary: `Send ${units(s?.pool.claimable)} ETH of your pool credit to your connected wallet.`,
          })}
        />
        <hr />
        <Pair label="Pool assets / cap">
          {units(s?.pool.totalAssets)} / {units(s?.pool.depositCap)} ETH
        </Pair>
        <Pair label="Idle liquidity">{units(s?.pool.idleAssets)} ETH</Pair>
        <Pair label="Outstanding principal">
          {units(s?.pool.totalBorrowed)} ETH
        </Pair>
        <Pair label="Loan fee income, cumulative">
          {units(s?.pool.cumulativeLoanFees)} ETH
        </Pair>
        <Pair label="Donations, cumulative">
          {units(s?.pool.cumulativeDonations)} ETH
        </Pair>
        <Pair label="Income still vesting">
          {units(s?.pool.unvestedDonations)} ETH
        </Pair>
        <Pair label="Shortfall reserve (target 5% of share assets)">
          {units(s?.pool.shortfallReserve)} /{" "}
          {units(s ? (s.pool.totalAssets * 500n) / 10000n : undefined)} ETH
        </Pair>
        <Pair label="Bounty reserve (target 0.2 ETH)">
          {units(s?.shop.bountyReserve)} ETH
        </Pair>
        <Pair label="Protocol fees paid to the fee recipient">
          {units(s?.shop.protocolFeesToRecipient)} ETH
        </Pair>
        <Pair label="Protocol fees added to reserves">
          {units(s?.shop.protocolFeesToReserves)} ETH
        </Pair>
        <Pair label="Released loss allowance still vesting">
          {units(s?.pool.unvestedRelease)} ETH
        </Pair>
        <Pair label="Recognized auction loss">
          {units(s?.pool.expectedAuctionLoss)} ETH
        </Pair>
        <Pair label="Realized loss, cumulative">
          {units(s?.pool.cumulativeLoss)} ETH
        </Pair>
        <p className="muted">
          Cumulative income is not an APR or a return promise. Reserve funds sit
          outside the share price.
        </p>
      </Panel>
    </div>
  );
}
export function Lock() {
  const e = useEngine(),
    s = e.snapshot,
    r = e.runtime;
  const [v, setV] = useState(""),
    [mode, setMode] = useState("lock"),
    [allowance, setAllowance] = useState<bigint>();
  const [moduleAddress, setModuleAddress] = useState("");
  const [old, setOld] = useState<{
    contract: Contract;
    locked: bigint;
    unlockable: bigint;
  }>();
  useEffect(() => {
    setAllowance(undefined);
    if (s && r && e.account)
      read(r, r.contracts.LaunchToken, "allowance", [
        e.account,
        s.lockContract.address,
      ])
        .then(setAllowance)
        .catch(() => setAllowance(undefined));
  }, [s?.at, e.account]);
  let n = 0n;
  try {
    n = amount(v, s?.token.decimals ?? 18);
  } catch {}
  const needsApproval =
    mode === "lock" && allowance !== undefined && allowance < n;
  return (
    <div className="workspace-grid">
      <Panel kicker="03 / Lock" title="PAWN earns a lower fee.">
        <Field
          label="Lock action"
          value={mode}
          onChange={setMode}
          options={[
            { value: "lock", label: "Lock PAWN" },
            { value: "unlock", label: "Unlock available PAWN" },
          ]}
        />
        <Field label="Amount (PAWN)" value={v} onChange={setV} type="number" />
        <Pair label="Wallet balance">
          {units(s?.token.balance, s?.token.decimals)} PAWN
        </Pair>
        <Pair label="Locked">{units(s?.lock.locked)} PAWN</Pair>
        <Pair label="Committed to loans">{units(s?.lock.committed)} PAWN</Pair>
        <Pair label="Available to unlock">
          {units(s?.lock.unlockable)} PAWN
        </Pair>
        <Action
          key={`${v}-${mode}-${needsApproval}-${s?.at}`}
          primary
          label={
            needsApproval
              ? "Approve PAWN for locking"
              : mode === "lock"
                ? "Lock PAWN"
                : "Unlock PAWN"
          }
          disabled={mode === "lock" && allowance === undefined}
          reason={
            mode === "lock" && allowance === undefined
              ? "Connect and load your allowance first."
              : undefined
          }
          prepare={() => {
            const n = amount(v, s!.token.decimals);
            if (mode === "lock" && n > s!.token.balance)
              throw Error("Amount exceeds your PAWN balance.");
            if (mode === "unlock" && n > s!.lock.unlockable)
              throw Error("Amount exceeds your unlockable PAWN.");
            return needsApproval
              ? {
                  contract: r!.contracts.LaunchToken,
                  functionName: "approve",
                  args: [s!.lockContract.address, n],
                  summary: `Approve exactly ${units(n)} PAWN for the discount module. Locking is a separate transaction.`,
                }
              : {
                  contract: s!.lockContract,
                  functionName: mode,
                  args: [n],
                  summary: `${mode === "lock" ? "Lock" : "Unlock"} ${units(n)} PAWN. Committed PAWN cannot be unlocked until its loan is released or its commitment changes.`,
                };
          }}
        />
      </Panel>
      <div>
        <Panel title="A commitment to your term">
          <Pair label="Tier 1 · 1 million PAWN">20% fee reduction</Pair>
          <Pair label="Tier 2 · 5 million PAWN">33.33% fee reduction</Pair>
          <Pair label="Tier 3 · 20 million PAWN">50% fee reduction</Pair>
          <p>
            A new loan or extension snapshots your tier. Unlocking uncommitted
            tokens does not change an existing loan fee.
          </p>
          <AddressLink
            value={s?.lockContract.address}
            label="Current discount module"
          />
        </Panel>
        <Panel title="Previous discount module">
          <p>
            If governance rotates the module, your old locks stay in the
            original module. Find its address in your loan details.
          </p>
          <Field
            label="Previous module address"
            value={moduleAddress}
            onChange={(x) => {
              setModuleAddress(x);
              setOld(undefined);
            }}
          />
          <ReadButton
            label="Load previous lock"
            run={async () => {
              if (!r || !e.account) throw Error("Connect first.");
              const c = {
                name: "Previous LockDiscount",
                address: address(moduleAddress),
                abi: r.abis.LockDiscount,
              };
              const shop = await read(r, c, "pawnShop");
              const token = await read(r, c, "pawnToken");
              if (
                shop.toLowerCase() !==
                  r.contracts.PawnShop.address.toLowerCase() ||
                token.toLowerCase() !==
                  r.contracts.LaunchToken.address.toLowerCase()
              )
                throw Error("This module is not bound to this deployment.");
              setOld({
                contract: c,
                locked: await read(r, c, "locked", [e.account]),
                unlockable: await read(r, c, "unlockable", [e.account]),
              });
            }}
          />
          {old && (
            <>
              <Pair label="Locked / unlockable">
                {units(old.locked)} / {units(old.unlockable)} PAWN
              </Pair>
              <Action
                label="Unlock previous balance"
                key={`${old.contract.address}-${old.unlockable}`}
                disabled={!old.unlockable}
                prepare={() => ({
                  contract: old.contract,
                  functionName: "unlock",
                  args: [old.unlockable],
                  summary: `Unlock ${units(old.unlockable)} PAWN from this previous module.`,
                })}
              />
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
