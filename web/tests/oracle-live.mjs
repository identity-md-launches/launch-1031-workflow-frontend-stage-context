// Real Chromium, live public RPC and oracle API. The wallet adapter only exposes
// the public owner address: signing, transactions and account mutation throw.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, extname } from "node:path";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const root = resolve(import.meta.dirname, "../.."),
  out = resolve(root, "artifacts");
mkdirSync(out, { recursive: true });
const verified = JSON.parse(
  readFileSync(resolve(out, "mainnet-verification.json")),
);
const requestId = "4a3fa40e-32c7-49d1-9a2c-08c30495a2a6";
const jobId = "139f66e5-3cca-455d-8bd9-39aa393e7b3d";
const server = createServer((req, res) => {
  try {
    const path = decodeURIComponent((req.url ?? "").split("?")[0]);
    if (!path.startsWith("/preview/") || path.includes(".."))
      throw Error("Not found");
    const file = resolve(root, "dist", path.slice(9) || "index.html");
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "application/javascript",
        ".json": "application/json",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".ttf": "font/ttf",
      }[extname(file)] ?? "application/octet-stream",
    );
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PAWN_CHROMIUM_PATH || undefined,
  args: ["--no-sandbox"],
});
const url =
  process.env.PAWN_SITE_URL ||
  `http://127.0.0.1:${server.address().port}/preview/`;
const report = {
  checkedAt: new Date().toISOString(),
  url,
  browser: browser.version(),
  mode: "Live RPC and oracle API, owner address via read-only wallet adapter; all signing methods reject. No transactions.",
  checks: [],
  consoleErrors: [],
  failedResources: [],
  oracleResponses: [],
  viewports: [],
  screenshots: [],
  accessibility: [],
};
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => report.consoleErrors.push(e.message));
  page.on("requestfailed", (r) =>
    report.failedResources.push({
      url: r.url(),
      error: r.failure()?.errorText,
    }),
  );
  page.on("response", (r) => {
    if (r.url().startsWith("https://api.imd.fun/oracle/"))
      report.oracleResponses.push({
        url: r.url(),
        status: r.status(),
        allowOrigin: r.headers()["access-control-allow-origin"] ?? null,
      });
  });
  await page.addInitScript((owner) => {
    window.__walletWrites = [];
    window.ethereum = {
      on: () => {},
      removeListener: () => {},
      request: async ({ method }) => {
        if (["eth_accounts", "eth_requestAccounts"].includes(method))
          return [owner];
        if (method === "eth_chainId") return "0x1";
        window.__walletWrites.push(method);
        throw Error("Read-only browser validation: signing is disabled.");
      },
    };
  }, verified.state.owner);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Contract reads verified/)).toBeVisible({
    timeout: 60000,
  });
  report.health = await page.locator(".health-bar").innerText();
  await expect(page.locator(".deployment")).toContainText("PawnShop");
  expect(
    await page
      .locator(".deployment a")
      .evaluateAll((links) => links.map((a) => a.href)),
  ).toContain(
    "https://etherscan.io/address/0xf0d9300d7d891bc842da540cc4ddef050da9bcd4",
  );
  report.checks.push(
    "Mainnet code, bindings and new PawnShop verified in browser",
  );
  const publicFlow = page.getByRole("region", {
    name: "Refresh floor",
    exact: true,
  });
  await publicFlow
    .getByRole("button", { name: "Refresh floor", exact: true })
    .click();
  await expect(publicFlow).toContainText(requestId, { timeout: 60000 });
  await expect(publicFlow.getByText(/Waiting for owner approval/)).toBeVisible({
    timeout: 60000,
  });
  report.checks.push(
    "Public Refresh floor automatically finds the requested live answer without pasting an id or signature",
  );
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Setup", exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await page.getByRole("link", { name: "Setup", exact: true }).click();
  await expect(page.locator(".setup-contracts")).toContainText(
    "0xf0d9300d7d891bc842da540cc4ddef050da9bcd4",
  );
  const flow = page.getByRole("region", { name: "Refresh floor", exact: true });
  await flow
    .getByRole("button", { name: "Fetch floor attestation", exact: true })
    .click();
  const approve = flow.getByRole("button", {
    name: "Approve this hash",
    exact: true,
  });
  await expect(approve).toBeEnabled({ timeout: 60000 });
  await expect(flow).toContainText(requestId);
  await expect(flow).toContainText("1.94 ETH");
  report.checks.push(
    "Setup automatically resolves request " +
      requestId +
      " and reaches enabled Approve this hash",
  );
  await flow.getByLabel("Floor request id").fill(jobId);
  await flow
    .getByRole("button", { name: "Fetch floor attestation", exact: true })
    .click();
  await expect(approve).toBeEnabled({ timeout: 60000 });
  await expect(flow).toContainText(requestId);
  report.checks.push(
    "Job UUID resolves to the canonical request UUID and reaches Approve this hash",
  );
  for (const width of [320, 390, 800, 1440]) {
    await page.setViewportSize({ width, height: 1050 });
    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    );
    expect(noOverflow).toBe(true);
    report.viewports.push({ width, noOverflow });
  }
  await approve.focus();
  await page.keyboard.press("Tab");
  report.keyboardNext = await page.evaluate(() => ({
    tag: document.activeElement.tagName,
    text: document.activeElement.textContent?.slice(0, 80),
  }));
  await approve.focus();
  await flow.screenshot({ path: resolve(out, "oracle-approve-desktop.png") });
  report.screenshots.push("artifacts/oracle-approve-desktop.png");
  await page.setViewportSize({ width: 390, height: 900 });
  await flow.screenshot({ path: resolve(out, "oracle-approve-mobile.png") });
  report.screenshots.push("artifacts/oracle-approve-mobile.png");
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  report.accessibility = scan.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    description: v.description,
    nodes: v.nodes.map((n) => ({
      target: n.target,
      summary: n.failureSummary,
    })),
  }));
  expect(report.accessibility).toEqual([]);
  report.rendered = await page.evaluate(() => {
    const selectors = [
      ".oracle-flow",
      ".oracle-flow .muted",
      ".oracle-flow button",
      ".field input",
    ];
    return selectors.map((selector) => {
      const el = document.querySelector(selector),
        s = getComputedStyle(el);
      return {
        selector,
        color: s.color,
        background: s.backgroundColor,
        fontSize: s.fontSize,
        fontFamily: s.fontFamily,
        lineHeight: s.lineHeight,
      };
    });
  });
  report.fontLoaded = await page.evaluate(() =>
    document.fonts.check("16px PawnPixel"),
  );
  expect(await page.evaluate(() => window.__walletWrites)).toEqual([]);
  expect(
    report.oracleResponses.some((r) => r.url.endsWith("/attestation")),
  ).toBe(false);
  expect(report.consoleErrors).toEqual([]);
  report.result = "passed";
} catch (e) {
  report.result = "failed";
  report.error = e.message;
  process.exitCode = 1;
  console.error(e);
} finally {
  writeFileSync(
    resolve(
      out,
      process.env.PAWN_SITE_URL
        ? "published-browser.json"
        : "live-browser.json",
    ),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
