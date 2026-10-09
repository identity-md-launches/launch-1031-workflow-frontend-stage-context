import { verifyDeployment } from "./verify-deployment.mjs";
import relayArtifact from "./floor-relay.json";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  fallback,
  http,
  keccak256,
  toBytes,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
} from "viem";
export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};
export type Deployment = {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  assets: { path: string; sha256: string }[];
  poolKey: PoolKey;
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    uniswapV4: {
      poolManager: Address;
      universalRouter: Address;
      quoter: Address;
      stateView: Address;
      positionManager: Address;
      permit2: Address;
      extendedSwapParams?: boolean;
    };
    pairToken: { address: Address; symbol: string; decimals: number };
    otherPairTokens?: { address: Address; symbol: string; decimals: number }[];
  };
  walletAddChain?: unknown;
};
export type Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<any>;
  on?: (event: string, cb: (args: any) => void) => void;
  removeListener?: (event: string, cb: (args: any) => void) => void;
};
declare global {
  interface Window {
    ethereum?: Provider;
  }
}
export type Contract = { address: Address; abi: Abi; name: string };
function sorted(x: any): any {
  return Array.isArray(x)
    ? x.map(sorted)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, sorted(x[k])]),
        )
      : x;
}
export function canonicalAbiHash(abi: Abi) {
  return keccak256(toBytes(JSON.stringify(sorted(abi)))).slice(2);
}
export function relativePath(p: string) {
  if (
    !p ||
    p.startsWith("/") ||
    p.includes("..") ||
    p.includes(":") ||
    p.includes("\\")
  )
    throw Error("Unsafe deployment asset path");
  return p;
}
async function readJSON(p: string) {
  const r = await fetch(new URL(relativePath(p), document.baseURI));
  if (!r.ok)
    throw Error(`Could not load ${p}. Reload or check the static export.`);
  return r.json();
}
export async function loadConfig() {
  const deployment: Deployment = await readJSON("imd-deployment.json");
  if (
    deployment.version !== 1 ||
    deployment.chainId !== deployment.network.chainId ||
    !deployment.network.rpcUrls.length
  )
    throw Error("Invalid deployment network");
  const contracts: Record<string, Contract> = {};
  const abis: Record<string, Abi> = {};
  await Promise.all(
    deployment.contracts.map(async (c) => {
      const abi: Abi = await readJSON(c.abiPath);
      if (canonicalAbiHash(abi) !== c.abiHash)
        throw Error(`${c.name} ABI verification failed`);
      abis[c.name] = abi;
      contracts[c.name] = { ...c, abi };
    }),
  );
  for (const name of ["LendingPool", "LockDiscount", "CollateralVault"]) {
    const path = `abi/${name}.json`;
    const asset = deployment.assets.find((a) => a.path === path);
    if (!asset) throw Error(`Deployment does not reference ${name} ABI`);
    const r = await fetch(new URL(relativePath(asset.path), document.baseURI));
    if (!r.ok) throw Error(`Missing ${name} ABI`);
    const bytes = await r.arrayBuffer();
    if (asset) {
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      )
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      if (hash !== asset.sha256) throw Error(`${name} ABI asset hash mismatch`);
    }
    abis[name] = JSON.parse(new TextDecoder().decode(bytes));
  }
  const chain = defineChain({
    id: deployment.chainId,
    name: deployment.network.name,
    nativeCurrency: deployment.network.nativeCurrency,
    rpcUrls: { default: { http: deployment.network.rpcUrls } },
    blockExplorers: {
      default: { name: "Explorer", url: deployment.network.explorer },
    },
  });
  const client = createPublicClient({
    chain,
    transport: fallback(
      deployment.network.rpcUrls.map((url) =>
        http(url, {
          timeout: 9000,
          retryCount: 0,
          batch: { wait: 20, batchSize: 20 },
        }),
      ),
      { rank: false, retryCount: 0 },
    ),
  });
  const verified = await verifyDeployment(
    client,
    deployment,
    abis,
    relayArtifact.runtimeCodeHash,
  );
  for (const c of verified.contracts) {
    if (contracts[c.name]?.address.toLowerCase() !== c.address.toLowerCase())
      throw Error(
        `${c.name} has changed on chain. Refresh the site deployment before transacting.`,
      );
  }
  return { deployment, contracts, abis, chain, client };
}
export type Runtime = Awaited<ReturnType<typeof loadConfig>>;
export function walletClient(r: Runtime, provider: Provider, account: Address) {
  return createWalletClient({
    account,
    chain: r.chain,
    transport: custom(provider),
  });
}
export const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);
export const erc721 = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function getApproved(uint256) view returns (address)",
  "function isApprovedForAll(address,address) view returns (bool)",
  "function approve(address,uint256)",
]);
export const permit2 = parseAbi([
  "function allowance(address,address,address) view returns (uint160,uint48,uint48)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);
export const router = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
]);
export const quoter = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut,uint256 gasEstimate)",
]);
export const stateView = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128)",
]);
export const native = "0x0000000000000000000000000000000000000000" as Address; // Protocol native-currency sentinel, never a deployment stand-in.
export const emptyHash = ("0x" + "0".repeat(64)) as Hex;
