// Build this into runtime.mjs with the pinned existing web toolchain. No runtime npm install.
export {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  parseAbi,
} from "viem";
export { privateKeyToAccount } from "viem/accounts";
export { mainnet } from "viem/chains";
export * from "../web/src/oracle";
