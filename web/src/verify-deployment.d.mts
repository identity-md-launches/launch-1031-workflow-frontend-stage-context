import type { Abi, Address, PublicClient } from "viem";
export const TARGETS: Readonly<Record<string, Address>>;
export function verifyDeployment(
  client: PublicClient,
  deployment: {
    chainId: number;
    contracts: { name: string; address: Address }[];
  },
  abis: Record<string, Abi>,
  relayCodeHash: string,
): Promise<{
  chainId: number;
  blockNumber: bigint;
  blockHash: string;
  contracts: {
    name: string;
    address: Address;
    codeBytes: number;
    runtimeCodeHash: string;
  }[];
  state: Record<string, any>;
}>;
