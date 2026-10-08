import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { World, mockWallet, manifest, addresses, owner } from "./mock-rpc";
import { decodeAbiParameters, parseAbiParameters } from "viem";
const root = resolve(import.meta.dirname, "../..");
const exportDir = resolve(root, "dist");
const evidence = resolve(root, "docs/frontend");
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
  if(process.env.PAWN_BROWSER_CHECK&&!name.includes(process.env.PAWN_BROWSER_CHECK)) return;
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
try {
  const { page, world, context } = await setup();
  await check(
    "Production subpath loads local assets and verified read state",
    async () => {
      await expect(page).toHaveTitle("Pawn — Put your seat to work");
      expect(await page.locator(".stat strong").allTextContents()).toContain(
        "1 ETH",
      );
      expect(await page.locator('script[src^="/"]').count()).toBe(0);
    },
  );
  await check(
    "Keyboard focus, desktop/mobile reflow, and accessibility scan",
    async () => {
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("link", { name: "Skip to content" }),
      ).toBeFocused();
      await page.screenshot({
        path: resolve(evidence, "desktop.png"),
        fullPage: true,
      });
      report.screenshots.push("desktop.png");
      for (const width of [320, 390, 800, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: resolve(evidence, "mobile.png"),
        fullPage: true,
      });
      report.screenshots.push("mobile.png");
      const axe = await new AxeBuilder({ page }).analyze();
      report.axe = {
        violations: axe.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => n.target),
        })),
        passes: axe.passes.length,
      };
      expect(axe.violations).toEqual([]);
      await page.setViewportSize({ width: 1440, height: 1050 });
    },
  );
  await check(
    "Wallet connection rejected, recovered, and wrong chain adds approved network",
    async () => {
      await page.evaluate(() => {
        (window as any).walletControl.reject = true;
      });
      await page
        .getByRole("button", { name: "Connect wallet", exact: true })
        .click();
      await expect(
        page.getByText("Request rejected in your wallet. You can try again."),
      ).toBeVisible();
      await page.evaluate(() => {
        (window as any).walletControl.reject = false;
        (window as any).walletControl.chain = "0xa";
        (window as any).walletControl.unknown = true;
      });
      await connect(page);
      await page
        .getByRole("button", { name: "Switch to Ethereum", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Switch to Ethereum", exact: true }),
      ).toHaveCount(0);
      const added = await page.evaluate(() =>
        (window as any).walletControl.calls.find(
          (c: any) => c.method === "wallet_addEthereumChain",
        ),
      );
      expect(added.params[0]).toEqual(manifest.walletAddChain);
    },
  );
  await check(
    "Deposit validates input and simulates before requesting wallet signature",
    async () => {
      await tab(page, "Lend");
      await page.getByLabel("Amount (ETH)", { exact: true }).fill("-1");
      await page
        .getByRole("button", { name: "Deposit ETH", exact: true })
        .click();
      await expect(page.getByText(/Enter a positive amount/)).toBeVisible();
      await page.getByLabel("Amount (ETH)", { exact: true }).fill("0.1");
      world.revertOn = "depositETH";
      await page
        .getByRole("button", { name: "Deposit ETH", exact: true })
        .click();
      await expect(
        page.getByText(/exceeds the remaining pool cap/),
      ).toBeVisible();
      expect(world.sends.length).toBe(0);
      world.revertOn = "";
      await page
        .getByRole("button", { name: "Deposit ETH", exact: true })
        .click();
      await page.evaluate(() => {
        (window as any).walletControl.reject = true;
      });
      await page
        .getByRole("button", { name: "Confirm deposit eth", exact: true })
        .click();
      await expect(
        page.locator(".action").getByText(/Request rejected/),
      ).toBeVisible();
      await page.evaluate(() => {
        (window as any).walletControl.reject = false;
      });
      await transaction(page, "Deposit ETH");
      expect(world.sends.at(-1).value).toBe(100000000000000000n);
    },
  );
  await check(
    "Withdrawal previews share burn, then separately claims pool ETH",
    async () => {
      await page.getByLabel("Pool action").selectOption("withdraw");
      await page.getByRole("button", { name: "Preview pool action" }).click();
      await expect(page.getByText(/pETH shares burned/)).toBeVisible();
      await transaction(page, "Withdraw ETH");
      await transaction(page, "Claim pool ETH");
      expect(world.sends.at(-1).fn).toBe("claim");
    },
  );
  await check(
    "Lock flow requires exact token approval, refreshes allowance, and unlocks available balance",
    async () => {
      await tab(page, "Lock PAWN");
      await page.getByLabel("Amount (PAWN)", { exact: true }).fill("100");
      await transaction(page, "Approve PAWN for locking");
      await transaction(page, "Lock PAWN");
      await page.getByLabel("Lock action").selectOption("unlock");
      await transaction(page, "Unlock PAWN");
      expect(world.locked).toBe(1000000n * 10n ** 18n);
    },
  );
  await check(
    "Seat inspection, upfront fee, token-specific NFT approval, and pawn",
    async () => {
      await tab(page, "Borrow");
      await page.getByLabel("Seat token ID", { exact: true }).fill("7");
      await page.getByRole("button", { name: "Inspect seat & loan" }).click();
      await expect(page.getByText("0.0096 ETH", { exact: true })).toBeVisible();
      await transaction(page, "Approve this seat");
      await transaction(page, "Pawn seat");
      const pawn = world.sends.at(-1);
      expect(pawn.fn).toBe("pawn");
      expect(pawn.args[1]).toBe(7n);
    },
  );
  await check(
    "Loan extension, worker authorization, reward call, vault ETH and token recovery",
    async () => {
      world.credit = 300000000000000000n;
      await tab(page, "Loans & auctions");
      await page.getByLabel("Look up loan ID").fill("1");
      await page
        .getByRole("button", { name: "Load loan", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Extend loan", exact: true }),
      ).toBeEnabled();
      await transaction(page, "Extend loan");
      await page
        .locator("summary")
        .filter({ hasText: "Authorize worker device" })
        .click();
      const pairing = {
        deviceKey: "0x" + "11".repeat(32),
        wallet: world.vault(1),
        tokenId: "7",
        nonce: "0x" + "22".repeat(32),
        expiresAt: String(Math.floor(Date.now() / 1000) + 86400),
        relayOrigin: "https://relay.identity.md",
      };
      await page
        .getByLabel("m (JSON object)", { exact: true })
        .fill(JSON.stringify(pairing));
      await transaction(page, "Authorize worker device");
      await transaction(page, "Revoke worker device");
      await transaction(page, "Move free vault ETH to credit");
      world.credit = 300000000000000000n;
      await transaction(page, "Claim vault ETH");
      await page
        .locator("summary")
        .filter({ hasText: "Claim rewards through vault" })
        .click();
      await page
        .getByLabel("target (address)", { exact: true })
        .fill(manifest.network.uniswapV4.quoter);
      await page.getByLabel("data (bytes)", { exact: true }).fill("0x12345678");
      await transaction(page, "Claim rewards through vault");
      await page
        .locator("summary")
        .filter({ hasText: "Withdraw vault tokens" })
        .click();
      await page
        .getByLabel("ERC-20 token address", { exact: true })
        .fill(addresses.LaunchToken);
      await page
        .getByRole("button", { name: "Read vault token balance", exact: true })
        .click();
      await page.getByLabel("Amount (PAWN)", { exact: true }).fill("1");
      await transaction(page, "Withdraw vault tokens");
      await transaction(page, "Repay loan");
      expect(world.loanStatus.get(1)).toBe(3);
    },
  );
  await check(
    "Overdue auction initiation and separate auction purchase",
    async () => {
      await page.getByLabel("Look up loan ID").fill("2");
      await page
        .getByRole("button", { name: "Load loan", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Start auction", exact: true }),
      ).toBeEnabled();
      await transaction(page, "Start auction");
      await page.getByLabel("Look up loan ID").fill("3");
      await page
        .getByRole("button", { name: "Load loan", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Buy auction seat", exact: true }),
      ).toBeEnabled();
      await transaction(page, "Buy auction seat");
      expect(world.sends.at(-1).value).toBe(700000000000000000n);
    },
  );
  await check(
    "ETH buy quote uses exact pool key; swap command and native value are correct",
    async () => {
      await tab(page, "Trade");
      await page.getByLabel("You pay (ETH)").fill("0.01");
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await expect(page.getByText("9,900 PAWN", { exact: true })).toBeVisible();
      await transaction(page, "Buy PAWN");
      const tx = world.sends.at(-1);
      expect(tx.to).toBe(
        manifest.network.uniswapV4.universalRouter.toLowerCase(),
      );
      expect(tx.args[0]).toBe("0x10");
      expect(tx.value).toBe(10000000000000000n);
      const [actions, params] = decodeAbiParameters(
        parseAbiParameters("bytes,bytes[]"),
        tx.args[1][0],
      );
      expect(actions).toBe("0x060c0f");
      const [swap] = decodeAbiParameters(
        parseAbiParameters(
          "((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)",
        ),
        params[0],
      );
      expect(swap.poolKey.hooks.toLowerCase()).toBe(manifest.poolKey.hooks);
      expect(swap.poolKey.fee).toBe(manifest.poolKey.fee);
    },
  );
  await check(
    "Token sale requires ERC-20 to Permit2 approval, then Permit2 to router, then zero-value swap",
    async () => {
      await page
        .getByRole("button", { name: "Sell PAWN", exact: true })
        .first()
        .click();
      await page.getByLabel("You pay (PAWN)").fill("100");
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await transaction(page, "Approve PAWN to Permit2");
      await transaction(page, "Approve router in Permit2");
      await transaction(page, "Sell PAWN");
      expect(world.sends.at(-1).value).toBe(0n);
      expect(world.sends.at(-2).to).toBe(
        manifest.network.uniswapV4.permit2.toLowerCase(),
      );
    },
  );
  await check(
    "Signed floor submission, bounty funding, burn funding and one-time burn",
    async () => {
      await tab(page, "Oracle & burn");
      await page
        .locator("summary")
        .filter({ hasText: "Post signed floor" })
        .click();
      const attestation = {
        requestId: "0x" + "33".repeat(32),
        chainId: "1",
        questionHash: world.floorHash,
        answerType: 3,
        answer: "0x" + (10n ** 18n).toString(16).padStart(64, "0"),
        figure: "0",
        fromBlock: "26146600",
        toBlock: "26146624",
        blockHash: "0x" + "44".repeat(32),
        panelJobId: "0x" + "55".repeat(32),
        panelSize: 5,
        quorum: 4,
        agreed: 4,
        issuedAt: String(Math.floor(Date.now() / 1000)),
        expiresAt: String(Math.floor(Date.now() / 1000) + 100000),
      };
      const floorForm = page.locator(".contract-form").filter({
        has: page.locator("summary", { hasText: "Post signed floor" }),
      });
      await floorForm
        .getByLabel("a (JSON object)", { exact: true })
        .fill(JSON.stringify(attestation));
      await floorForm
        .getByLabel("signature (bytes)", { exact: true })
        .fill("0x" + "11".repeat(65));
      await transaction(page, "Post signed floor");
      expect(world.sends.at(-1).args[1].answerType).toBe(3);
      await page.getByLabel("Top up bounty reserve (ETH)").fill("0.02");
      await transaction(page, "Fund oracle & auction bounties");
      await page.getByLabel("Send to burn vault (PAWN)").fill("1000");
      await transaction(page, "Fund burn vault");
      await page
        .locator("summary")
        .filter({ hasText: "Trigger milestone burn" })
        .click();
      const burnForm = page.locator(".contract-form").filter({
        has: page.locator("summary", { hasText: "Trigger milestone burn" }),
      });
      await burnForm.getByLabel("a (JSON object)", { exact: true }).fill(
        JSON.stringify({
          ...attestation,
          answer: "0x" + (1000000n * 10n ** 18n).toString(16).padStart(64, "0"),
        }),
      );
      await burnForm
        .getByLabel("signature (bytes)", { exact: true })
        .fill("0x" + "22".repeat(65));
      await transaction(page, "Trigger milestone burn");
      await expect(
        page.getByRole("button", { name: "Fund burn vault", exact: true }),
      ).toBeDisabled();
      await tab(page, "Trade");
      await page
        .getByRole("button", { name: "Sell PAWN", exact: true })
        .click();
      await page.getByLabel("You pay (PAWN)").fill("100");
    },
  );
  await check("Quote expiration disables execution", async () => {
    await page.getByRole("button", { name: "Get quote", exact: true }).click();
    await expect(page.locator(".receipt")).toBeVisible();
    await page.clock.setFixedTime(new Date(Date.now() + 61000));
    await expect(
      page.getByText("Quote expired. Get a fresh quote to continue."),
    ).toBeVisible();
    await expect(
      page.locator(".action button").filter({ hasText: "Sell PAWN" }),
    ).toBeDisabled();
    await page.clock.setFixedTime(new Date());
  });
  await check(
    "Owner setup, cap queue, and permissionless execution controls",
    async () => {
      await tab(page, "Governance");
      await page.getByLabel("New deposit cap (ETH)").fill("20");
      await transaction(page, "Queue higher deposit cap");
      await transaction(page, "Execute deposit cap");
      await transaction(page, "Pause new loans");
      expect(world.paused).toBe(true);
    },
  );
  await check(
    "Read errors disable every transaction and remain recoverable",
    async () => {
      world.noCode = true;
      await page
        .getByRole("button", { name: "Refresh state", exact: true })
        .click();
      await expect(
        page.getByText("Live state could not be verified."),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Queue higher deposit cap",
          exact: true,
        }),
      ).toBeDisabled();
      world.noCode = false;
      await page
        .getByRole("button", { name: "Refresh state", exact: true })
        .click();
      await expect(page.getByText(/Contract reads verified/)).toBeVisible();
    },
  );
  report.mockTransactions = world.sends.map(({ fn, to, value }) => ({
    function: fn,
    to,
    value: String(value),
  }));
  report.rpcRequests = world.calls.length;
  await context.close();
  await check(
    "Missing-wallet guidance remains visible and actionable",
    async () => {
      const { page, context } = await setup({ missing: true });
      await page
        .getByRole("button", { name: "Connect wallet", exact: true })
        .click();
      await expect(page.getByText(/No browser wallet found/)).toBeVisible();
      await context.close();
    },
  );
  await check(
    "Pending receipt disables duplicate writes and disconnected account resets controls",
    async () => {
      const { page, world, context } = await setup();
      await connect(page);
      await tab(page, "Lend");
      await page.getByLabel("Amount (ETH)", { exact: true }).fill("0.05");
      await page
        .getByRole("button", { name: "Deposit ETH", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Review transaction" }),
      ).toBeVisible();
      await page.setViewportSize({ width: 320, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const scan = await new AxeBuilder({ page }).analyze();
      expect(scan.violations).toEqual([]);
      report.reviewAxe = { violations: 0, passes: scan.passes.length };
      await page.screenshot({
        path: resolve(evidence, "transaction-review.png"),
        fullPage: true,
      });
      report.screenshots.push("transaction-review.png");
      world.receiptDelay = 1500;
      await page
        .getByRole("button", { name: "Confirm deposit eth", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Claim pool ETH", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Confirm deposit eth", exact: true }),
      ).toBeDisabled();
      await expect(page.getByText(/: Confirmed\./)).toBeVisible({
        timeout: 15000,
      });
      expect(world.sends.length).toBe(1);
      await page.evaluate(() =>
        (window as any).emitWallet("accountsChanged", []),
      );
      await expect(
        page.getByRole("button", { name: "Connect wallet", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Deposit ETH", exact: true }),
      ).toBeDisabled();
      await context.close();
    },
  );
  await check('Keyboard-only wallet, seat approval, review and pawn flow',async()=>{
    const {page,world,context}=await setup();
    async function tabTo(locator:any){for(let i=0;i<100;i++){if(await locator.count()===1&&await locator.evaluate((el:any)=>el===document.activeElement))return;await page.keyboard.press('Tab');}throw Error('Keyboard target not reachable');}
    await tabTo(page.getByRole('button',{name:'Connect wallet',exact:true}));await page.keyboard.press('Enter');
    await expect(page.getByRole('button',{name:'Disconnect',exact:true})).toBeVisible();
    await expect(page.getByText(/Contract reads verified/)).toBeVisible();
    await tabTo(page.getByLabel('Seat token ID',{exact:true}));await page.keyboard.type('7');
    await page.screenshot({path:resolve(evidence,'keyboard-focus.png'),fullPage:true});report.screenshots.push('keyboard-focus.png');
    await tabTo(page.getByRole('button',{name:'Inspect seat & loan',exact:true}));await page.keyboard.press('Enter');
    await expect(page.getByRole('button',{name:'Approve this seat',exact:true})).toBeVisible();
    for(const label of ['Approve this seat','Pawn seat']){
      await tabTo(page.getByRole('button',{name:label,exact:true}));await page.keyboard.press('Enter');
      await expect(page.getByRole('heading',{name:'Review transaction'})).toBeVisible();
      await tabTo(page.getByRole('button',{name:'Confirm '+label.toLowerCase(),exact:true}));await page.keyboard.press('Enter');
      await expect(page.getByText(/: Confirmed\./)).toBeVisible({timeout:15000});
    }
    expect(world.sends.map(x=>x.fn)).toEqual(['approve','pawn']);await context.close();
  });
  expect(report.consoleErrors).toEqual([]);
  expect(report.failedResources).toEqual([]);
  report.result = "passed";
} catch (e: any) {
  report.result = "failed";
  report.error = e.stack;
  const failedPage=browser.contexts().at(-1)?.pages().at(-1);
  if(failedPage) report.visibleFeedback=await failedPage.locator("[role=status], [role=alert]").allTextContents();
  console.error(e);
  if(report.visibleFeedback) console.error(report.visibleFeedback);
  process.exitCode = 1;
} finally {
  writeFileSync(
    resolve(evidence, process.env.PAWN_BROWSER_CHECK ? "browser-targeted-results.json" : "browser-results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
}
