import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { chromium, expect } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";
import { World, mockWallet, addresses, owner, collection } from "./mock-rpc";
import { oracleTypes, question, zeroHash } from "../src/oracle";
const root = resolve(import.meta.dirname, "../.."),
  dist = resolve(root, "dist");
const server = createServer((req, res) => {
  try {
    const p =
      decodeURIComponent((req.url ?? "/").split("?")[0]) === "/"
        ? "/index.html"
        : decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (p.includes("..")) throw Error();
    res.setHeader(
      "Content-Type",
      (
        {
          ".html": "text/html",
          ".js": "application/javascript",
          ".json": "application/json",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".ttf": "font/ttf",
        } as any
      )[extname(p)] ?? "application/octet-stream",
    );
    res.end(readFileSync(resolve(dist, p.slice(1) || "index.html")));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
console.log("Browser launched");
const report: string[] = [],
  errors: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    world = new World();
  console.log("Page created");
  const signer = privateKeyToAccount("0x" + "11".repeat(32)),
    now = Math.floor(Date.now() / 1000),
    id = "62702d2a-1a38-4543-93cc-7ece5ac20a66";
  const hash = "0x" + "aa".repeat(32);
  let stored = 0n;
  world.floorHash = zeroHash;
  const oldRead = world.callValue.bind(world);
  world.callValue = (to, fn, args) =>
    fn === "oracleSigner"
      ? signer.address
      : fn === "floors"
        ? [stored ? 2n * 10n ** 18n : 0n, stored, BigInt(now + 93600), 0n]
        : oldRead(to, fn, args);
  const oldSend = world.send.bind(world);
  world.send = (tx) => {
    const d = world.decode(tx);
    if (d.fn === "setQuestionHashOnce") world.floorHash = (d.args as any)[1];
    if (d.fn === "submitFloor") stored = BigInt((d.args as any)[1].issuedAt);
    return oldSend(tx);
  };
  const oldRPC = world.rpc.bind(world);
  world.rpc = async (payload) =>
    Array.isArray(payload)
      ? Promise.all(payload.map((p) => world.rpc(p)))
      : payload.method === "eth_getCode" && payload.params[0].toLowerCase() === signer.address.toLowerCase()
        ? { jsonrpc: "2.0", id: payload.id, result: "0x" }
      : payload.method === "eth_getBlockByNumber"
        ? {
            jsonrpc: "2.0",
            id: payload.id,
            result: {
              number: "0x18ef738",
              timestamp: "0x" + now.toString(16),
              hash: "0x" + "bb".repeat(32),
              parentHash: "0x" + "cc".repeat(32),
              transactions: [],
              gasLimit: "0x1c9c380",
              gasUsed: "0x0",
              difficulty: "0x0",
              totalDifficulty: "0x0",
              size: "0x1",
              extraData: "0x",
              nonce: "0x0000000000000000",
              miner: owner,
              baseFeePerGas: "0x1",
            },
          }
        : oldRPC(payload);
  const domain = {
    name: "IdentityMD Oracle",
    version: "2",
    chainId: 1,
    verifyingContract: addresses.PawnShop as `0x${string}`,
  };
  const message = {
    requestId: "0x" + id.replaceAll("-", "") + "0".repeat(32),
    chainId: 1n,
    questionHash: hash,
    answerType: 3,
    answer: "0x" + (2n * 10n ** 18n).toString(16).padStart(64, "0"),
    figure: 0n,
    fromBlock: 100n,
    toBlock: 200n,
    blockHash: "0x" + "bb".repeat(32),
    panelJobId: "0x" + "cc".repeat(32),
    panelSize: 5,
    quorum: 4,
    agreed: 4,
    issuedAt: BigInt(now),
    expiresAt: BigInt(now + 93600),
  };
  const signature = await signer.signTypedData({
    domain,
    types: oracleTypes,
    primaryType: "OracleAttestation",
    message,
  });
  let wrongDomain = false;
  let purchases = 0;
  const json = (x: any) =>
    JSON.parse(
      JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    );
  await page.addInitScript("window.__name = (fn) => fn;");
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(
    /https:\/\/(ethereum-rpc.publicnode.com|eth.drpc.org)\/?$/,
    async (route) => {
      if (route.request().method() === "OPTIONS")
        return route.fulfill({
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "POST",
            "access-control-allow-headers": "content-type",
          },
        });
      return route.fulfill({
        json: await world.rpc(route.request().postDataJSON()),
        headers: { "access-control-allow-origin": "*" },
      });
    },
  );
  await page.route("https://api.imd.fun/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST",
          "access-control-allow-headers":
            "authorization,content-type,payment-signature",
        },
      });
    const fulfill = ({ status = 200, json }: any) =>
      route.fulfill({
        status,
        json,
        headers: { "access-control-allow-origin": "*" },
      });
    if (!path.startsWith("/oracle/requests/") || route.request().method() !== "GET") {
      purchases++;
      return fulfill({ status: 403, json: { error: "No purchase routes allowed" } });
    }
    if (path.endsWith("/attestation"))
      return fulfill({
        json: json({
          domain: {
            ...domain,
            verifyingContract: wrongDomain
              ? addresses.MilestoneBurn
              : domain.verifyingContract,
          },
          message,
          signer: signer.address,
          signature,
        }),
      });
    if (path === "/oracle/requests") return fulfill({ json: { requests: [] } });
    return fulfill({
      json: {
        status: "attested",
        question: question("floor"),
        questionHash: hash,
        chainId: 1,
        answerType: "uint256",
        evidence: "panel",
        toleranceBps: 500,
        signer: signer.address,
      },
    });
  });
  await mockWallet(page, world);
  await page.goto(`http://127.0.0.1:${(server.address() as any).port}/`, {
    waitUntil: "domcontentloaded",
  });
  console.log("Site loaded");
  console.log("Waiting for RPC snapshot");
  await Promise.race([
    expect(page.getByText(/Contract reads verified/)).toBeVisible({
      timeout: 15000,
    }),
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            Error(
              "RPC snapshot timeout; calls=" +
                world.calls.length +
                "; page errors=" +
                JSON.stringify(errors),
            ),
          ),
        20000,
      ),
    ),
  ]);
  console.log("Snapshot verified");
  await expect(
    page.getByRole("link", { name: "Setup", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Refresh floor", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Setup", exact: true }),
  ).toBeVisible();
  report.push(
    "Owner-only Setup navigation; public refresh disabled before wallet connection.",
  );
  await page.getByRole("link", { name: "Setup", exact: true }).click();
  await expect(page.getByRole("heading", { name: "1. Floor" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send 10,000,000 PAWN", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(root, "docs/frontend/setup-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  report.push("Mobile Setup renders all steps with no horizontal overflow.");
  const floor = page.locator(".oracle-flow").first();
  await floor.getByLabel("Floor request id").fill(id);
  wrongDomain = true;
  await floor
    .getByRole("button", { name: "Post floor", exact: true })
    .click();
  await expect(floor.getByRole("alert")).toContainText("only answers signed for this contract");
  expect(world.sends).toHaveLength(0);
  report.push(
    "Wrong consumer rejected before any setup or posting transaction.",
  );
  wrongDomain = false;
  await floor
    .getByRole("button", { name: "Post floor", exact: true })
    .click();
  await expect(
    floor.getByText("Done: floor posted and chain state refreshed."),
  ).toBeVisible({ timeout: 20000 });
  expect(world.sends.map((x) => x.fn)).toEqual([
    "setQuestionHashOnce",
    "submitFloor",
  ]);
  expect(world.sends[0].args).toEqual([collection, hash]);
  report.push(
    "Pasted paid-elsewhere request pins unset question once then posts verified floor.",
  );
  await floor
    .getByRole("button", { name: "Post floor", exact: true })
    .click();
  await expect(
    floor.getByText("Done: this floor or a newer one is already stored."),
  ).toBeVisible();
  expect(world.sends).toHaveLength(2);
  report.push(
    "Already stored floor is idempotent and sends no duplicate transaction.",
  );
  await expect(floor.getByRole("button", { name: "Request floor", exact: true })).toHaveCount(0);
  await expect(floor.getByRole("button", { name: "Copy question", exact: true })).toBeVisible();
  expect(purchases).toBe(0);
  report.push("Request-id flow performs only public oracle GETs and has no purchase controls.");
  await page.getByRole("link", { name: "Borrow", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Refresh floor", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: resolve(root, "docs/frontend/night-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: resolve(root, "docs/frontend/night-desktop.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  writeFileSync(
    resolve(root, "docs/frontend/setup-browser-results.json"),
    JSON.stringify({ checks: report, errors }, null, 2) + "\n",
  );
  console.log(report.join("\n"));
} catch (error) {
  console.error("Browser test failure:", error);
  throw error;
} finally {
  await Promise.race([
    browser.close(),
    new Promise((r) => setTimeout(r, 5000)),
  ]);
  server.closeAllConnections();
  server.close();
}
