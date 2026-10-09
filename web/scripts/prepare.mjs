import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { root, web, header, files, sha } from "./common.mjs";
import { verifyLaunch } from "./verify-launch.mjs";

const report = await verifyLaunch({ write: true });
mkdirSync(resolve(web, "public/abi"), { recursive: true });
for (const file of Object.keys(report.source.files)) {
  writeFileSync(
    resolve(web, "public/abi", file),
    readFileSync(resolve(root, "docs/abi", file)),
  );
}
writeFileSync(
  resolve(web, "public/imd-deployment.json"),
  JSON.stringify(
    {
      ...header(),
      assets: files(resolve(web, "public"))
        .filter((path) => path !== "imd-deployment.json")
        .map((path) => ({
          path,
          sha256: sha(readFileSync(resolve(web, "public", path))),
        })),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Prepared audit-fixed ABIs and ${report.contracts.length} on-chain verified contract addresses at block ${report.blockNumber}.`,
);
