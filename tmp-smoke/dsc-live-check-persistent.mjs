import { chromium } from "playwright-core";

async function waitForDscHeading(page) {
  await page.waitForLoadState("domcontentloaded");
  const timeoutMs = 60000;
  const pollMs = 500;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const dscCount = await page.locator('h3:has-text("Design System Controls")').count();
    if (dscCount > 0) {
      return dscCount;
    }

    const currentUrl = page.url();
    if (currentUrl.includes("/login")) {
      return 0;
    }

    await page.waitForTimeout(pollMs);
  }

  return page.locator('h3:has-text("Design System Controls")').count();
}

async function ensureDscExpanded(page) {
  const baseHexInput = page.locator('input[aria-label="base harmony hex"]');
  if (await baseHexInput.count()) {
    return;
  }

  const expandButton = page.locator('article:has(h3:has-text("Design System Controls")) button:has-text("Expand")').first();
  if (await expandButton.count()) {
    await expandButton.click();
  }

  await page.waitForSelector('input[aria-label="base harmony hex"]', { timeout: 30000 });
}

async function readHexPair(page) {
  const baseHex = await page.locator('input[aria-label="base harmony hex"]').inputValue();
  const brandHex = await page.locator('input[aria-label="brand harmony hex"]').inputValue();
  return { baseHex, brandHex };
}

async function run() {
  const edgePath = process.env.CF_EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  const userDataDir = process.env.CF_EDGE_USER_DATA_DIR || "C:/Users/ronal/AppData/Local/Microsoft/Edge/User Data";
  const profileDirectory = process.env.CF_EDGE_PROFILE_DIR || "Default";
  const headless = process.env.CF_EDGE_HEADLESS !== "false";
  const screenshotPrefix = process.env.CF_DSC_SCREENSHOT_PREFIX || "tmp-smoke/dsc-live";

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    executablePath: edgePath,
    args: [`--profile-directory=${profileDirectory}`],
  });

  const page = context.pages()[0] ?? await context.newPage();
  await page.goto("http://localhost:5173/settings", { waitUntil: "domcontentloaded", timeout: 60000 });

  const dscHeadingCount = await waitForDscHeading(page);
  const url = page.url();

  if (!dscHeadingCount) {
    await page.screenshot({ path: `${screenshotPrefix}-no-dsc.png`, fullPage: true });
    console.log(JSON.stringify({ ok: false, reason: "dsc-not-found", url, title: await page.title() }, null, 2));
    await context.close();
    return;
  }

  await ensureDscExpanded(page);
  await page.screenshot({ path: `${screenshotPrefix}-startup-expanded.png`, fullPage: true });

  const startup = await readHexPair(page);

  const resetButton = page.locator('button:has-text("Reset to defaults"), button:has-text("Reset to Defaults")').first();
  await resetButton.click();
  await page.waitForTimeout(1000);
  await ensureDscExpanded(page);
  await page.screenshot({ path: `${screenshotPrefix}-after-reset.png`, fullPage: true });

  const afterReset = await readHexPair(page);

  await context.close();

  const context2 = await chromium.launchPersistentContext(userDataDir, {
    headless,
    executablePath: edgePath,
    args: [`--profile-directory=${profileDirectory}`],
  });
  const page2 = context2.pages()[0] ?? await context2.newPage();

  await page2.goto("http://localhost:5173/settings", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForDscHeading(page2);

  await ensureDscExpanded(page2);
  await page2.screenshot({ path: `${screenshotPrefix}-after-restart.png`, fullPage: true });

  const afterRestart = await readHexPair(page2);

  console.log(JSON.stringify({
    ok: true,
    baseHex: startup.baseHex,
    brandHex: startup.brandHex,
    resetBaseHex: afterReset.baseHex,
    resetBrandHex: afterReset.brandHex,
    rebootBaseHex: afterRestart.baseHex,
    rebootBrandHex: afterRestart.brandHex,
    url,
  }, null, 2));

  await context2.close();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
