import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { dist, files, sha, header } from "./common.mjs";
const assets = files(dist)
  .filter((p) => p !== "imd-deployment.json")
  .map((path) => ({ path, sha256: sha(readFileSync(resolve(dist, path))) }));
writeFileSync(
  resolve(dist, "imd-deployment.json"),
  JSON.stringify({ ...header(), assets }, null, 2) + "\n",
);
await import("./validate-export.mjs");
