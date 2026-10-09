// Public read-only verification; no deployment record from .imd/reads is used.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, fallback, http } from "viem";
import { root, web, json, abiHash, sha } from "./common.mjs";
import { verifyDeployment } from "../src/verify-deployment.mjs";

export async function verifyLaunch({ write = false } = {}) {
  const deployment = json(resolve(web, "deployment.json"));
  const source = json(resolve(web, "abi-source.json"));
  const network = json(resolve(web, "network.json")).network;
  const abis = {};
  for (const [file, expected] of Object.entries(source.files)) {
    const bytes = readFileSync(resolve(root, "docs/abi", file));
    if (sha(bytes) !== expected)
      throw Error(`ABI bytes differ from launch 1139 source: ${file}`);
    const abi = JSON.parse(bytes);
    if (!Array.isArray(abi)) throw Error(`ABI must be an array: ${file}`);
    abis[file.replace(/\.json$/, "")] = abi;
  }
  const client = createPublicClient({
    transport: fallback(
      network.rpcUrls.map((url) =>
        http(url, { timeout: 15000, retryCount: 1 }),
      ),
      { retryCount: 0 },
    ),
  });
  const report = {
    checkedAt: new Date().toISOString(),
    source,
    rpcUrls: network.rpcUrls,
    mode: "Public read-only mainnet eth_chainId, eth_getBlockByNumber, eth_getCode and eth_call. oracleSigner() is the attester getter. No wallet or broadcast.",
    ...(await verifyDeployment(
      client,
      deployment,
      abis,
      json(resolve(web, "src/floor-relay.json")).runtimeCodeHash,
    )),
  };
  const stringify = (value) =>
    JSON.stringify(
      value,
      (_, x) => (typeof x === "bigint" ? String(x) : x),
      2,
    ) + "\n";
  if (write) {
    deployment.contracts = report.contracts.map(({ name, address }) => {
      const prior = deployment.contracts.find((c) => c.name === name) ?? {};
      const getter = {
        LendingPool: "lendingPool",
        LockDiscount: "discountModule",
        VaultFactory: "vaultFactory",
      }[name];
      return {
        ...prior,
        name,
        address,
        abiHash: abiHash(abis[name]),
        ...(getter
          ? {
              discoveredFrom: {
                address: deployment.contracts.find((c) => c.name === "PawnShop")
                  .address,
                getter,
                blockNumber: Number(report.blockNumber),
              },
            }
          : {}),
      };
    });
    deployment.abiSource = source;
    deployment.abiInstructions =
      "ABIs copied from launch 1139 main at abiSource.sourceCommit; source SHA-256 checks plus shared mainnet code, binding and key-call verification in prepare and runtime. Original launch 994 is token provenance only.";
    deployment.verification = {
      blockNumber: Number(report.blockNumber),
      blockHash: report.blockHash,
      report: "artifacts/mainnet-verification.json",
    };
    writeFileSync(resolve(web, "deployment.json"), stringify(deployment));
    const keeper = json(resolve(root, "keeper/config.json"));
    keeper.addresses = Object.fromEntries(
      report.contracts.map((c) => [c.name, c.address]),
    );
    writeFileSync(resolve(root, "keeper/config.json"), stringify(keeper));
    mkdirSync(resolve(root, "artifacts"), { recursive: true });
    writeFileSync(
      resolve(root, "artifacts/mainnet-verification.json"),
      stringify(report),
    );
  }
  return report;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const report = await verifyLaunch({
    write: process.argv.includes("--write"),
  });
  console.log(
    `Verified ${report.contracts.length} Ethereum contracts at block ${report.blockNumber}; owner ${report.state.owner}.`,
  );
}
