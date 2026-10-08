import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { World, mockWallet, manifest, addresses, owner } from "./mock-rpc";
import {
  encodeAbiParameters,
  parseAbiParameters,
  encodeEventTopics,
} from "viem";
import { countdown } from "../src/governance-state";
const root = resolve(import.meta.dirname, "../..");
const exportDir = resolve(root, "dist");
const evidence = resolve(root, "artifacts");
const server = createServer((req, res) => {
  try {
    const path = decodeURIComponent((req.url ?? "").split("?")[0]);
    if (!path.startsWith("/preview/") || path.includes("..")) {
      res.writeHead(404);
      res.end();
      return;
    }
    const file = resolve(exportDir, path.slice(9) || "index.html");
    const mime: Record<string, string> = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".json": "application/json",
      ".css": "text/css",
      ".svg": "image/svg+xml",
    };
    res.setHeader(
      "Content-Type",
      mime[extname(file)] ?? "application/octet-stream",
    );
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${(server.address() as any).port}/preview/`;
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const report: any = {
  checkedAt: new Date().toISOString(),
  browser: browser.version(),
  exportURL: "local /preview/ subpath",
  checks: [],
  screenshots: [],
  consoleErrors: [],
  failedResources: [],
};
async function check(name: string, fn: () => Promise<void>) {
  if (
    process.env.PAWN_BROWSER_CHECK &&
    !name.includes(process.env.PAWN_BROWSER_CHECK)
  )
    return;
  await fn();
  report.checks.push({ name, result: "passed" });
  console.log("PASS", name);
}
async function setup(opts: any = {}) {
  const world = new World();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  const page = await context.newPage();
  await page.addInitScript("window.__name = (fn) => fn;");
  page.on("pageerror", (e) => report.consoleErrors.push(e.message));
  page.on("requestfailed", (req) => report.failedResources.push(req.url()));
  await page.route(
    /https:\/\/(ethereum-rpc.publicnode.com|eth.drpc.org)\/?$/,
    async (route) => {
      const data = await world.rpc(route.request().postDataJSON());
      await route.fulfill({
        json: data,
        headers: { "access-control-allow-origin": "*" },
      });
    },
  );
  opts.configure?.(world);
  await mockWallet(page, world, opts);
  await page.goto(url);
  await expect(page.getByText(/Contract reads verified/)).toBeVisible({
    timeout: 30000,
  });
  return { world, page, context };
}
async function connect(page: any) {
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Disconnect", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Contract reads verified/)).toBeVisible();
}
async function tab(page: any, name: string) {
  await page.getByRole("link", { name, exact: true }).click();
}
async function transaction(page: any, label: string) {
  await page
    .locator(".action")
    .getByRole("button", { name: label, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review transaction", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: `Confirm ${label.toLowerCase()}`,
      exact: true,
    })
    .click();
  await expect(page.getByText(/: Confirmed\./)).toBeVisible({ timeout: 15000 });
}
const other = addresses.LaunchToken; // Existing address used only as a test wallet.
const future = BigInt(Math.floor(Date.now() / 1000) + 3600);
const operations = ["11", "22", "33"].map((x) => `0x${x.repeat(32)}`);
function configure(world: World) {
  world.paused = true;
  const call = world.callValue.bind(world),
    rpc = world.rpc.bind(world);
  world.callValue = (to, fn, args) =>
    fn === "pendingCapAt"
      ? future
      : fn === "pendingCap"
        ? 20n * 10n ** 18n
        : fn === "queuedAt"
          ? args[0] === operations[2]
            ? 0n
            : future
          : call(to, fn, args);
  world.rpc = async (payload) =>
    Array.isArray(payload)
      ? Promise.all(payload.map((p) => world.rpc(p)))
      : payload.method === "eth_getLogs"
        ? {
            jsonrpc: "2.0",
            id: payload.id,
            result: operations.map((op, i) => ({
              address: addresses.PawnShop,
              topics: encodeEventTopics({
                abi: world.abi(addresses.PawnShop),
                eventName: "ChangeQueued",
                args: { operation: op },
              }),
              data: encodeAbiParameters(parseAbiParameters("uint256"), [
                future,
              ]),
              blockNumber: "0x18ef738",
              blockHash: `0x${"aa".repeat(32)}`,
              transactionHash: `0x${"bb".repeat(32)}`,
              transactionIndex: "0x0",
              logIndex: `0x${i}`,
              removed: false,
            })),
          }
        : rpc(payload);
}
async function hidden(page: any) {
  await expect(
    page.getByRole("link", { name: "Setup", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator(
      ".tool input, .tool textarea, .tool select, .tool .action, .tool .contract-form",
    ),
  ).toHaveCount(0);
  await expect(
    page.locator(".tool").getByText("Paused", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".tool").getByText("Floor question hash", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".tool").getByText("Deposit cap", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".tool").getByText(operations[0], { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".tool").getByText(operations[1], { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".tool").getByText(operations[2], { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".tool").getByText(/Ready in/)).toHaveCount(3);
}
try {
  await check(
    "Countdown boundaries: waiting, ready, exact expiry, expired, cap without expiry",
    async () => {
      expect(countdown(100n, 99)).toBe("Ready in 0d 0h 0m 1s");
      expect(countdown(100n, 100)).toBe("Ready to apply");
      expect(countdown(100n, 100, 101n)).toBe("Ready · expires in 0d 0h 0m 1s");
      expect(countdown(100n, 101, 101n)).toBe("Ready · expires in 0d 0h 0m 0s");
      expect(countdown(100n, 102, 101n)).toBe("Expired — must be queued again");
    },
  );
  const { page, world, context } = await setup({ account: other, configure });
  await check(
    "Disconnected direct Setup route is read-only; all active queue hashes and cap countdown visible",
    async () => {
      await page.goto(url + "#setup");
      await hidden(page);
      const before = await page
        .locator(".tool")
        .getByText(/Ready in/)
        .first()
        .textContent();
      await expect
        .poll(() =>
          page
            .locator(".tool")
            .getByText(/Ready in/)
            .first()
            .textContent(),
        )
        .not.toBe(before);
    },
  );
  await check(
    "Non-owner Governance omits every owner form, claim and execution control",
    async () => {
      await connect(page);
      await tab(page, "Governance");
      await hidden(page);
      expect(world.sends).toHaveLength(0);
    },
  );
  await check(
    "Production Governance reflows at 320, 390, 800 and 1440; axe scan",
    async () => {
      for (const width of [320, 390, 800, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
      const axe = await new AxeBuilder({ page }).analyze();
      report.axe = axe.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      }));
      expect(report.axe).toEqual([]);
      await page.screenshot({
        path: resolve(evidence, "owner-state-desktop.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: resolve(evidence, "owner-state-mobile.png"),
        fullPage: true,
      });
      report.fontLoaded = await page.evaluate(() =>
        document.fonts.check("16px PawnPixel"),
      );
      expect(report.fontLoaded).toBe(true);
      report.colors = await page
        .locator(".tool .panel")
        .first()
        .evaluate((el) => {
          const panel = getComputedStyle(el),
            label = getComputedStyle(el.querySelector(".pair > span")!);
          return {
            text: panel.color,
            background: panel.backgroundColor,
            muted: label.color,
          };
        });
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(
        await page
          .getByRole("button", { name: "Refresh state", exact: true })
          .evaluate((el) => getComputedStyle(el).transitionDuration),
      ).toBe("0s");
    },
  );
  await check(
    "Public Refresh floor remains enabled for a non-owner; unset hash gives recovery guidance",
    async () => {
      world.floorHash = "0x" + "00".repeat(32);
      await page
        .getByRole("button", { name: "Refresh state", exact: true })
        .click();
      await expect(
        page.locator(".tool").getByText("Not set", { exact: true }),
      ).toBeVisible();
      await tab(page, "Borrow");
      const refresh = page.getByRole("button", {
        name: "Refresh floor",
        exact: true,
      });
      await expect(refresh).toBeEnabled();
      await refresh.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("alert")).toContainText(
        "setup authority must configure",
      );
      expect(world.sends).toHaveLength(0);
    },
  );
  await context.close();
  const owned = await setup({ configure });
  await check(
    "Owner controls appear, pause transaction completes, account switch removes open reviews and Setup",
    async () => {
      await connect(owned.page);
      await expect(
        owned.page.getByRole("link", { name: "Setup", exact: true }),
      ).toBeVisible();
      await tab(owned.page, "Governance");
      await expect(
        owned.page.getByLabel("New deposit cap (ETH)"),
      ).toBeVisible();
      await expect(
        owned.page
          .locator("summary")
          .filter({ hasText: "Queue oracle signer" }),
      ).toBeVisible();
      await expect(
        owned.page.getByRole("button", {
          name: "Claim protocol fee credit",
          exact: true,
        }),
      ).toBeVisible();
      await transaction(owned.page, "Unpause new loans");
      expect(owned.world.paused).toBe(false);
      await owned.page
        .getByRole("button", { name: "Pause new loans", exact: true })
        .click();
      await expect(
        owned.page.getByRole("heading", { name: "Review transaction" }),
      ).toBeVisible();
      await owned.page.evaluate(
        (a) => (window as any).emitWallet("accountsChanged", [a]),
        other,
      );
      await expect(
        owned.page.getByRole("heading", { name: "Review transaction" }),
      ).toHaveCount(0);
      await expect(
        owned.page.getByRole("link", { name: "Setup", exact: true }),
      ).toHaveCount(0);
      await expect(
        owned.page.locator(".tool .action, .tool input"),
      ).toHaveCount(0);
      expect(owned.world.sends).toHaveLength(1);
    },
  );
  await owned.context.close();
  const split = await setup({
    configure: (w: World) => {
      configure(w);
      const call = w.callValue.bind(w);
      w.callValue = (to, fn, args) =>
        fn === "owner" && to === addresses.LendingPool
          ? other
          : call(to, fn, args);
    },
  });
  await check(
    "Independent pool owner: shop owner cannot see pool cap controls in Governance or Setup",
    async () => {
      await connect(split.page);
      await tab(split.page, "Governance");
      await expect(
        split.page.getByRole("button", {
          name: "Unpause new loans",
          exact: true,
        }),
      ).toBeVisible();
      await expect(split.page.getByLabel("New deposit cap (ETH)")).toHaveCount(
        0,
      );
      await tab(split.page, "Setup");
      await expect(
        split.page.getByRole("heading", { name: "1. Floor", exact: true }),
      ).toBeVisible();
      await expect(
        split.page.getByRole("button", { name: "Raise", exact: true }),
      ).toHaveCount(0);
      await expect(
        split.page.getByRole("button", {
          name: "Apply raised cap",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        split.page.getByRole("button", {
          name: "Claim protocol fees",
          exact: true,
        }),
      ).toBeVisible();
      await split.page
        .getByRole("button", { name: "Disconnect", exact: true })
        .click();
      await hidden(split.page);
    },
  );
  await split.context.close();
  expect(report.consoleErrors).toEqual([]);
  expect(report.failedResources).toEqual([]);
  writeFileSync(
    resolve(evidence, "owner-browser-results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  server.close();
}
