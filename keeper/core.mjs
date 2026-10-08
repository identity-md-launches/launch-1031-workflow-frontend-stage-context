// SPDX-License-Identifier: MIT
export function profitable(bounty, gas, maxFeePerGas, alwaysRun = false) {
  // Bounties are pull credits: include the later claim cost and a 20% gas margin.
  return alwaysRun || bounty >= ((gas + 45000n) * maxFeePerGas * 120n) / 100n;
}
export function floorBounty(floor, reserve, now) {
  return (floor[3] === 0n || now >= floor[3] + 86400n) &&
    reserve >= 1000000000000000n
    ? 1000000000000000n
    : 0n;
}
export function auctionBounty(reserve) {
  return reserve >= 2000000000000000n ? 2000000000000000n : 0n;
}
export function loanAction(loan, now) {
  if (Number(loan.status) === 1 && now > loan.due + 259200n) return "start";
  if (Number(loan.status) === 2 && now >= loan.auctionStarted + 259200n)
    return "stuck";
  return "skip";
}
export async function attempt(
  client,
  wallet,
  contract,
  functionName,
  args,
  bounty,
  { alwaysRun = false, dryRun = true, alert = async () => {} } = {},
) {
  const call = {
    address: contract.address,
    abi: contract.abi,
    functionName,
    args,
    account: wallet.account,
  };
  const { request } = await client.simulateContract(call);
  const gas = await client.estimateContractGas(call);
  const fees = await client.estimateFeesPerGas();
  const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice;
  if (!maxFeePerGas) throw Error("Gas price unavailable.");
  if (!profitable(bounty, gas, maxFeePerGas, alwaysRun))
    return { status: "unprofitable", gas, bounty };
  if (
    (await client.getBalance({ address: wallet.account.address })) <
    (gas * maxFeePerGas * 120n) / 100n
  )
    throw Error("Keeper ETH balance does not cover gas.");
  if (dryRun) return { status: "dry-run", gas, bounty };
  const hash = await wallet.writeContract({
    ...request,
    gas: (gas * 120n) / 100n,
    maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  });
  const receipt = await client.waitForTransactionReceipt({
    hash,
    confirmations: 1,
    timeout: 180000,
  });
  if (receipt.status !== "success")
    throw Error(`${functionName} reverted on chain.`);
  await alert(`${functionName} confirmed: ${hash}`);
  return { status: "confirmed", hash };
}
