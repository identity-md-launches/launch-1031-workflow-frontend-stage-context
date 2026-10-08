import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { chromium } from "@playwright/test";
const root = resolve(import.meta.dirname, "../.."),
  dist = resolve(root, "dist");
const server = createServer((req, res) => {
  try {
    const path = (req.url ?? "").split("?")[0];
    if (!path.startsWith("/preview/") || path.includes(".."))
      throw Error("Not found");
    const file = resolve(dist, path.slice(9) || "index.html");
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
      }[extname(file)] ?? "application/octet-stream",
    );
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const report = {
  checkedAt: new Date().toISOString(),
  browser: browser.version(),
  mode: "Production export, live public RPC, no wallet injected, no transactions",
  consoleErrors: [],
  requestFailures: [],
  contrasts: [],
  viewports: [],
};
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  page.on("pageerror", (e) => report.consoleErrors.push(e.message));
  page.on("requestfailed", (r) =>
    report.requestFailures.push({
      url: r.url(),
      error: r.failure()?.errorText,
    }),
  );
  await page.goto(`http://127.0.0.1:${server.address().port}/preview/`);
  await page.getByText(/Contract reads verified/).waitFor({ timeout: 60000 });
  report.statistics = await page.locator(".stat").allTextContents();
  report.health = await page.locator(".health-bar").innerText();
  report.contrasts = await page.evaluate(() => {
    const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const luminance = (rgb) =>
      rgb
        .map((x) => x / 255)
        .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
        .reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0);
    return [
      "body",
      ".hero",
      "h1 em",
      ".stat > span",
      ".panel > p",
      ".field label",
      ".field small",
      ".connection-hint",
      ".notice.warning",
    ]
      .map((selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const style = getComputedStyle(el);
        let current = el,
          bg;
        while (current) {
          bg = getComputedStyle(current).backgroundColor;
          if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") break;
          current = current.parentElement;
        }
        const foreground = rgb(style.color),
          background = rgb(bg);
        const a = luminance(foreground),
          b = luminance(background);
        return {
          selector,
          foreground: style.color,
          background: bg,
          opacity: style.opacity,
          ratio: Number(
            ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2),
          ),
        };
      })
      .filter(Boolean);
  });
  for (const width of [320, 390, 800, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    report.viewports.push({
      width,
      noOverflow: await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    });
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({
    path: resolve(root, "docs/frontend/live-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Trade", exact: true }).click();
  await page.getByLabel("You pay (ETH)").fill("0.01");
  await page.getByRole("button", { name: "Get quote", exact: true }).click();
  await page
    .getByText(
      "This pool has no active liquidity. Trading is unavailable until liquidity is added.",
    )
    .waitFor({ timeout: 60000 });
  report.liveQuote =
    "Zero active liquidity is reported; no quote or signing action offered.";
  report.result = "passed";
} catch (e) {
  report.result = "failed";
  report.error = e.message;
  process.exitCode = 1;
} finally {
  writeFileSync(
    resolve(root, "docs/frontend/live-browser.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise((r) => server.close(r));
}
