import { useState } from "react";
import { useEngine, read } from "./engine";
import { emptyHash } from "./config";
import { amount, parseInput } from "./logic";
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
import { ContractForm } from "./forms";
import { Countdown, QueuedChanges } from "./governance-state";
export function Operations() {
  const e = useEngine(),
    s = e.snapshot,
    r = e.runtime;
  const [fund, setFund] = useState(""),
    [burnFund, setBurnFund] = useState("");
  return (
    <div className="workspace-grid">
      <Panel kicker="06 / Oracle & upkeep" title="Keep the floor fresh.">
        <Pair label="Stored floor">{units(s?.floor[0])} ETH</Pair>
        <Pair label="Issued">{when(s?.floor[1])}</Pair>
        <Pair label="Expires">{when(s?.floor[2])}</Pair>
        <Pair label="Floor status">
          {s
            ? s.fresh
              ? "Fresh"
              : "Stale / not submitted"
            : "Waiting for RPC"}
        </Pair>
        <Pair label="Bounty reserve">{units(s?.shop.bountyReserve)} ETH</Pair>
        <Pair label="Oracle signer">
          <AddressLink value={s?.shop.oracleSigner} />
        </Pair>
        <p>
          A floor attestation must match the configured question and this
          PawnShop’s signing domain. It needs at least 5 panel members, a quorum
          of at least 4, and a fresh, unexpired answer.
        </p>
        {s?.collection[5] === emptyHash && (
          <Notice tone="warning">
            The seat floor question is not configured. The owner can set it in
            Governance.
          </Notice>
        )}
        {r && s && (
          <ContractForm
            key={s.collectionAddress}
            contract={r.contracts.PawnShop}
            fn="submitFloor"
            label="Post signed floor"
            description="Post the complete signed oracle attestation and signature. The first valid update in each 24-hour interval may earn 0.001 ETH if the bounty reserve is funded. ETH is credited for a separate claim."
            defaults={{ collection: s.collectionAddress }}
            disabled={s.collection[5] === emptyHash}
          />
        )}
        <Field
          label="Top up bounty reserve (ETH)"
          value={fund}
          onChange={setFund}
          type="number"
        />
        <Action
          key={fund}
          label="Fund oracle & auction bounties"
          prepare={() => ({
            contract: r!.contracts.PawnShop,
            functionName: "fundBounties",
            value: amount(fund),
            summary: `Permanently add ${fund} ETH to the bounty reserve. This does not request or purchase an oracle attestation.`,
          })}
        />
        <p className="muted">
          Bring a signed attestation from the oracle workflow. Use Setup or
          Borrow to purchase and post a verified floor, or supply signed
          evidence here.
        </p>
      </Panel>
      <Panel kicker="The $1M milestone" title="A one-time PAWN burn.">
        <Pair label="PAWN in burn vault">
          {units(s?.burn.balance, s?.token.decimals)} PAWN
        </Pair>
        <Pair label="Already burned">
          {units(s?.burn.burnedAmount, s?.token.decimals)} PAWN
        </Pair>
        <Pair label="Milestone">$1,000,000 fully diluted market cap</Pair>
        <Pair label="Burn state">
          {s
            ? s.burn.burned
              ? "Completed"
              : s.burn.questionHash === emptyHash
                ? "Setup required"
                : "Awaiting signed evidence"
            : "Waiting for RPC"}
        </Pair>
        <p>
          Anyone can trigger the burn with a qualifying oracle attestation.
          Tokens sent here cannot be withdrawn. This is a one-time event.
        </p>
        {s?.burn.questionHash === emptyHash && (
          <Notice tone="warning">
            The designated question setter must configure the burn question
            first.
          </Notice>
        )}
        <Field
          label="Send to burn vault (PAWN)"
          value={burnFund}
          onChange={setBurnFund}
          type="number"
        />
        <Action
          key={burnFund}
          label="Fund burn vault"
          disabled={!!s?.burn.burned}
          reason={
            s?.burn.burned
              ? "The burn has completed. Further deposits would remain stranded."
              : undefined
          }
          prepare={() => ({
            contract: r!.contracts.LaunchToken,
            functionName: "transfer",
            args: [
              r!.contracts.MilestoneBurn.address,
              amount(burnFund, s!.token.decimals),
            ],
            summary: `Permanently transfer ${burnFund} PAWN to MilestoneBurn. There is no withdrawal. The balance burns only once the signed milestone is reached.`,
          })}
        />
        {r && (
          <>
            <ContractForm
              contract={r.contracts.MilestoneBurn}
              fn="burn"
              label="Trigger milestone burn"
              description="Irreversibly burn the entire PAWN vault balance using a signed attestation of fully diluted market cap at or above $1,000,000 (USD with 18 decimals). No live USD progress is available until you supply valid evidence."
              disabled={
                !s ||
                s.burn.burned ||
                s.burn.questionHash === emptyHash ||
                !s.burn.balance
              }
            />
            <Action
              label="Sync governed oracle signer"
              prepare={() => ({
                contract: r.contracts.MilestoneBurn,
                functionName: "syncSigner",
                summary:
                  "Mirror PawnShop’s current governed signer in MilestoneBurn. The burn also syncs the signer automatically.",
              })}
            />
          </>
        )}
      </Panel>
    </div>
  );
}
export function Governance() {
  const e = useEngine(),
    s = e.snapshot,
    r = e.runtime;
  const [cap, setCap] = useState(""),
    [op, setOp] = useState(""),
    [queued, setQueued] = useState<bigint>();
  const owner =
      !!e.account && e.account.toLowerCase() === s?.shop.owner.toLowerCase(),
    poolOwner =
      !!e.account && e.account.toLowerCase() === s?.pool.owner.toLowerCase(),
    setter =
      !!e.account &&
      e.account.toLowerCase() === s?.burn.questionSetter.toLowerCase();
  const controls = [
    [
      "queueTerm",
      "Queue loan term",
      "Queue a term: id 0 or 1; duration 7–90 days in seconds; fee 50–1,000 bps. Open loans keep their saved terms.",
    ],
    [
      "queueCollection",
      "Queue collection settings",
      "Queue collection settings. Max loan is 4,000 bps; non-seat allocation is capped at 2,500 bps. Include the real oracle question hash.",
    ],
    [
      "queueAttester",
      "Queue oracle signer",
      "Queue a new, nonzero oracle attester. The change waits 48 hours.",
    ],
    [
      "queueFeeRecipient",
      "Queue fee recipient",
      "Queue the recipient of protocol fees after the bounty and pool reserves are filled.",
    ],
    [
      "queueDiscountModule",
      "Queue discount module",
      "Queue a module bound to this PawnShop and PAWN token. Existing loans retain their original module.",
    ],
    [
      "disableCollection",
      "Disable new collection loans",
      "Immediately stop new loans for this collection. Repayment and settlement remain available.",
    ],
    [
      "cancelChange",
      "Cancel queued change",
      "Cancel the exact operation hash from a ChangeQueued event.",
    ],
  ] as const;
  const executes = [
    ["executeTerm", "Execute loan term"],
    ["executeCollection", "Execute collection settings"],
    ["executeAttester", "Execute oracle signer"],
    ["executeFeeRecipient", "Execute fee recipient"],
    ["executeDiscountModule", "Execute discount module"],
  ] as const;
  return (
    <>
      <Notice>
        Governance changes that affect lenders wait 48 hours. PawnShop queued
        changes expire 7 days after they become executable. Pool cap increases
        have no execution expiry.
      </Notice>
      <div className="workspace-grid">
        <Panel
          kicker="07 / Governance"
          title={owner ? "Launch setup & owner controls" : "Owner state"}
        >
          <Pair label="PawnShop owner">
            <AddressLink value={s?.shop.owner} />
          </Pair>
          <Pair label="Pending owner">
            <AddressLink value={s?.shop.pendingOwner} />
          </Pair>
          <Pair label="New loans">
            {s ? (s.shop.newLoansPaused ? "Paused" : "Open") : "Loading…"}
          </Pair>
          <Pair label="Floor question hash">
            {s
              ? s.collection[5] === emptyHash
                ? "Not set"
                : "Set"
              : "Loading…"}
          </Pair>
          <Pair label="Oracle signer">
            <AddressLink value={s?.shop.oracleSigner} />
          </Pair>
          {!owner && (
            <p className="muted">
              Connect the current owner to change PawnShop settings.
            </p>
          )}
          {owner && r && s && (
            <>
              <Action
                label={
                  s.shop.newLoansPaused
                    ? "Unpause new loans"
                    : "Pause new loans"
                }
                disabled={
                  !owner ||
                  (s.shop.newLoansPaused &&
                    (s.collection[5] === emptyHash || !s.fresh))
                }
                reason={
                  s.shop.newLoansPaused && !s.fresh
                    ? "Configure a question and submit a fresh floor before opening borrowing."
                    : undefined
                }
                prepare={() => ({
                  contract: r.contracts.PawnShop,
                  functionName: "setNewLoansPaused",
                  args: [!s.shop.newLoansPaused],
                  summary: `${s.shop.newLoansPaused ? "Open" : "Pause"} new borrowing. Repayment, extension, auctions, withdrawals, claims and unlocks remain governed by their own eligibility rules.`,
                })}
              />
              <ContractForm
                contract={r.contracts.PawnShop}
                fn="setQuestionHashOnce"
                label="Set initial collection question"
                description="Set the real oracle floor question hash for a collection whose question is still unset. This one-time path cannot overwrite an existing hash; use a queued collection update after setup."
                defaults={{ collection: s.collectionAddress }}
                disabled={!owner}
              />
              {setter && (
                <ContractForm
                  contract={r.contracts.MilestoneBurn}
                  fn="setQuestionHashOnce"
                  label="Set initial burn question"
                  description="Permanently set the signed-oracle question for PAWN’s fully diluted market cap. Only the immutable question setter can do this, and only once."
                  disabled={!setter || s.burn.questionHash !== emptyHash}
                />
              )}
              <p className="muted">
                Both deployed oracle consumers already require a nonzero signer.
                There is no initial zero-attester setter in this source; signer
                changes use the queue below.
              </p>
              {controls.map(([fn, label, description]) => (
                <ContractForm
                  key={fn}
                  contract={r.contracts.PawnShop}
                  {...{ fn, label, description }}
                  disabled={!owner}
                />
              ))}
              <ContractForm
                contract={r.contracts.PawnShop}
                fn="transferOwnership"
                label="Nominate PawnShop owner"
                description="Nominate a new owner. The nominee must accept ownership in a separate transaction."
                disabled={!owner}
              />
              <Action
                label="Accept PawnShop ownership"
                disabled={
                  e.account?.toLowerCase() !== s.shop.pendingOwner.toLowerCase()
                }
                prepare={() => ({
                  contract: r.contracts.PawnShop,
                  functionName: "acceptOwnership",
                  summary: "Accept the pending PawnShop ownership nomination.",
                })}
              />
              <Action
                label="Claim protocol fee credit"
                disabled={!s.shop.claimable}
                prepare={() => ({
                  contract: r.contracts.PawnShop,
                  functionName: "claim",
                  args: [e.account],
                  summary: `Claim ${units(s.shop.claimable)} ETH of your credited shop balance. Use Lending → Donate ETH to forward fees to lenders if desired.`,
                })}
              />
            </>
          )}
        </Panel>
        <div>
          <Panel title="Pool cap & ownership">
            <Pair label="Pool owner">
              <AddressLink value={s?.pool.owner} />
            </Pair>
            <Pair label="Deposit cap">{units(s?.pool.depositCap)} ETH</Pair>
            <Pair label="Pending cap">{units(s?.pool.pendingCap)} ETH</Pair>
            <Pair label="Executable after">{when(s?.pool.pendingCapAt)}</Pair>
            {!!s?.pool.pendingCapAt && (
              <Pair label="Cap countdown">
                <Countdown at={s.pool.pendingCapAt} />
              </Pair>
            )}
            {poolOwner && (
              <>
                <Field
                  label="New deposit cap (ETH)"
                  value={cap}
                  onChange={setCap}
                  type="number"
                />
                <Action
                  key={cap}
                  label="Queue higher deposit cap"
                  disabled={!poolOwner}
                  prepare={() => {
                    const n = amount(cap);
                    if (n <= s!.pool.depositCap)
                      throw Error(
                        "The new cap must be higher than the current cap.",
                      );
                    return {
                      contract: s!.poolContract,
                      functionName: "queueDepositCap",
                      args: [n],
                      summary: `Queue a higher deposit cap of ${cap} ETH. It becomes executable after 48 hours.`,
                    };
                  }}
                />
                <Action
                  label="Execute deposit cap"
                  disabled={
                    !s ||
                    !s.pool.pendingCapAt ||
                    BigInt(Math.floor(Date.now() / 1000)) < s.pool.pendingCapAt
                  }
                  prepare={() => ({
                    contract: s!.poolContract,
                    functionName: "executeDepositCap",
                    summary: `Apply the queued ${units(s!.pool.pendingCap)} ETH deposit cap.`,
                  })}
                />
                {s && (
                  <>
                    <ContractForm
                      contract={s.poolContract}
                      fn="transferOwnership"
                      label="Nominate pool owner"
                      description="Nominate the next LendingPool owner. Acceptance is a separate transaction."
                      disabled={!poolOwner}
                    />
                    <Action
                      label="Accept pool ownership"
                      disabled={
                        e.account?.toLowerCase() !==
                        s.pool.pendingOwner.toLowerCase()
                      }
                      prepare={() => ({
                        contract: s.poolContract,
                        functionName: "acceptOwnership",
                        summary:
                          "Accept the pending LendingPool ownership nomination.",
                      })}
                    />
                  </>
                )}
              </>
            )}
          </Panel>
          <Panel title="Queued changes">
            <QueuedChanges />
            {owner && (
              <>
                <p>
                  Use the exact parameters from the queue transaction.
                  Simulation checks the delay, expiry, and contract requirements
                  before signing.
                </p>
                <Field
                  label="Operation hash (bytes32)"
                  value={op}
                  onChange={(x) => {
                    setOp(x);
                    setQueued(undefined);
                  }}
                />
                <ReadButton
                  label="Check queued operation"
                  run={async () => {
                    if (!r) throw Error("Wait for configuration.");
                    setQueued(
                      await read(r, r.contracts.PawnShop, "queuedAt", [
                        parseInput({ type: "bytes32", name: "operation" }, op),
                      ]),
                    );
                  }}
                />
                {queued !== undefined && (
                  <Notice>
                    {queued === 0n ? (
                      "No pending change at this hash."
                    ) : (
                      <>
                        <Countdown at={queued} expires={queued + 604800n} /> ·
                        Executable {when(queued)}; expires{" "}
                        {when(queued + 604800n)}.
                      </>
                    )}
                  </Notice>
                )}
                {r &&
                  executes.map(([fn, label]) => (
                    <ContractForm
                      key={fn}
                      contract={r.contracts.PawnShop}
                      {...{ fn, label }}
                      description="Apply the previously queued change after its 48-hour delay and within its 7-day execution window. Parameters must exactly match the queue transaction."
                    />
                  ))}
              </>
            )}
            <p>
              <AddressLink
                value={r?.contracts.PawnShop.address}
                label="View governance events on Etherscan"
              />
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}
