import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PAWN_CHROMIUM_PATH || undefined,
  args: ["--no-sandbox"],
});
const report = {
  checkedAt: new Date().toISOString(),
  browser: browser.version(),
  responses: [],
  errors: [],
};
try {
  const page = await browser.newPage();
  page.on("response", async (r) => {
    if (r.url().includes("/oracle/requests"))
      report.responses.push({
        url: r.url(),
        status: r.status(),
        allowOrigin: r.headers()["access-control-allow-origin"] ?? null,
      });
  });
  page.on("console", (m) => {
    if (m.type() === "error") report.errors.push(m.text());
  });
  await page.goto("https://pawn-put-your-seat-to-work.sites.imd.fun/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  report.origin = await page.evaluate(() => location.origin);
  report.probes = await page.evaluate(async () => {
    const paths = [
      "/oracle/requests?limit=1",
      "/oracle/requests?limit=100",
      "/oracle/requests?limit=1000",
      "/oracle/requests/4a3fa40e-32c7-49d1-9a2c-08c30495a2a6",
      "/oracle/requests/4a3fa40e-32c7-49d1-9a2c-08c30495a2a6/attestation",
    ];
    const results = [];
    for (const path of paths) {
      try {
        const r = await fetch("https://api.imd.fun" + path, {
          signal: AbortSignal.timeout(20000),
        });
        const d = await r.json();
        results.push({
          path,
          status: r.status,
          keys: Object.keys(d),
          error: d.error,
          message: d.message,
          count: d.requests?.length,
          requestId: d.id,
          signed: !!d.signature && !!d.attestation,
        });
      } catch (e) {
        results.push({ path, error: String(e) });
      }
    }
    return results;
  });
} finally {
  await browser.close();
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(
    "artifacts/oracle-cors.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
}
