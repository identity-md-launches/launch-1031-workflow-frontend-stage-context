// Run after forge build. Uses Foundry cast for an offline reproducible hash.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const artifact = JSON.parse(readFileSync(new URL("../out/FloorRelay.sol/FloorRelay.json", import.meta.url)));
const record = {
  contract: "FloorRelay",
  chainId: 1,
  attester: "0x5598aa9146215bc13eb26f2c692ad1461fd32982",
  compiler: "0.8.26",
  runtimeCodeHash: execFileSync("cast", ["keccak", artifact.deployedBytecode.object], { encoding: "utf8" }).trim(),
};
writeFileSync(new URL("../web/src/floor-relay.json", import.meta.url), JSON.stringify(record, null, 2) + "\n");
writeFileSync(new URL("../docs/abi/FloorRelay.json", import.meta.url), JSON.stringify(artifact.abi, null, 2) + "\n");
