import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { keccak256, toBytes } from "viem";
export const root = fileURLToPath(new URL("../../", import.meta.url));
export const web = resolve(root, "web"),
  dist = resolve(root, "dist");
export const json = (p) => JSON.parse(readFileSync(p, "utf8"));
export const canonical = (x) => JSON.stringify(sort(x));
function sort(x) {
  return Array.isArray(x)
    ? x.map(sort)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, sort(x[k])]),
        )
      : x;
}
export const abiHash = (x) => keccak256(toBytes(canonical(x))).slice(2);
export const sha = (x) => createHash("sha256").update(x).digest("hex");
export function files(dir, prefix = "") {
  return readdirSync(dir)
    .sort()
    .flatMap((n) =>
      statSync(resolve(dir, n)).isDirectory()
        ? files(resolve(dir, n), prefix + n + "/")
        : [prefix + n],
    );
}
export const handoff = json(resolve(web, "deployment.json")),
  chain = json(resolve(web, "network.json"));
export function header() {
  return {
    version: 1,
    launchId: handoff.launchId,
    chainId: handoff.chainId,
    sourceCommit: handoff.sourceCommit,
    attestationHash: handoff.attestationHash,
    contracts: handoff.contracts.map(({ name, address, abiHash }) => ({
      name,
      address,
      abiHash,
      abiPath: `abi/${name}.json`,
    })),
    ...(handoff.poolKey ? { poolKey: handoff.poolKey } : {}),
    ...chain,
  };
}
