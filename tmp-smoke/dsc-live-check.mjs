import { chromium } from "playwright-core";

async function run() {
  const edgePath = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  const browser = await chromium.launch({ headless: true, executablePath: edgePath });

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("http://localhost:5173/settings", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);

  const dscHeadingCount = await page.locator('h3:has-text("Design System Controls")').count();
  if (!dscHeadingCount) {
    console.log(JSON.stringify({ ok: false, reason: "dsc-not-found", title: await page.title(), url: page.url() }, null, 2));
    await browser.close();
    return;
  }

  const expand = page.locator('article:has(h3:has-text("Design System Controls")) button:has-text("Expand")').first();
  await expand.click();
  await page.waitForSelector('input[aria-label="base harmony hex"]', { timeout: 10000 });

  const baseHex = await page.locator('input[aria-label="base harmony hex"]').inputValue();
  const brandHex = await page.locator('input[aria-label="brand harmony hex"]').inputValue();

  await page.locator('button:has-text("Reset to defaults")').first().click();
  await page.waitForTimeout(600);

  const resetBaseHex = await page.locator('input[aria-label="base harmony hex"]').inputValue();
  const resetBrandHex = await page.locator('input[aria-label="brand harmony hex"]').inputValue();

  await context.close();

  const context2 = await browser.newContext();
  const page2 = await context2.newPage();
  await page2.goto("http://localhost:5173/settings", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page2.waitForTimeout(1500);

  await page2.locator('article:has(h3:has-text("Design System Controls")) button:has-text("Expand")').first().click();
  await page2.waitForSelector('input[aria-label="base harmony hex"]', { timeout: 10000 });

  const rebootBaseHex = await page2.locator('input[aria-label="base harmony hex"]').inputValue();
  const rebootBrandHex = await page2.locator('input[aria-label="brand harmony hex"]').inputValue();

  console.log(JSON.stringify({
    ok: true,
    baseHex,
    brandHex,
    resetBaseHex,
    resetBrandHex,
    rebootBaseHex,
    rebootBrandHex,
  }, null, 2));

  await browser.close();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
