import { verifyLaunch } from "./verify-launch.mjs";
const report = await verifyLaunch({ write: true });
console.log(
  `Verified ${report.contracts.length} mainnet contracts at block ${report.blockNumber}; report: artifacts/mainnet-verification.json`,
);
