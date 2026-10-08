import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { dist, json, files, sha, header, abiHash } from "./common.mjs";
const m = json(resolve(dist, "imd-deployment.json"));
const { assets, ...config } = m;
assert.deepEqual(config, header(), "Exact configuration/schema mismatch");
assert(assets.length <= 128);
assert.deepEqual(
  assets.map((a) => a.path).sort(),
  files(dist)
    .filter((p) => p !== "imd-deployment.json")
    .sort(),
);
let bytes = 0;
for (const a of assets) {
  assert(
    !a.path.startsWith("/") && !a.path.includes("..") && !a.path.includes(":"),
  );
  const buf = readFileSync(resolve(dist, a.path));
  assert(buf.length <= 8388608);
  bytes += buf.length;
  assert.equal(a.sha256, sha(buf));
}
for (const c of m.contracts)
  assert.equal(abiHash(json(resolve(dist, c.abiPath))), c.abiHash);
assert(bytes < 30 * 1024 * 1024);
assert(assets.some((a) => a.path === "index.html"));
assert(!readFileSync(resolve(dist, "index.html"), "utf8").includes('src="/'));
console.log(
  `Export verified: ${assets.length} assets, ${bytes} bytes; exact handoff, poolKey, network, ABI hashes and every SHA-256 match.`,
);
