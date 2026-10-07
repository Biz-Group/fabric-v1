// Opens a visible Chrome window on the tenant so the user can sign in.
// The persistent profile keeps the Clerk session for later headless capture runs.
import { chromium } from "playwright";

const ctx = await chromium.launchPersistentContext("./profile", {
  channel: "chrome",
  headless: false,
  viewport: null,
  args: ["--window-size=1440,960"],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto("https://biz-group.bizfabric.ai");
console.log("Waiting for sign-in...");

const deadline = Date.now() + 15 * 60 * 1000;
while (Date.now() < deadline) {
  const url = page.url();
  const onApp =
    url.startsWith("https://biz-group.bizfabric.ai") &&
    !/sign-in|sign-up|join-organization/.test(url);
  const loading = await page
    .getByText(/Loading your workspace|Setting up your workspace/)
    .count()
    .catch(() => 1);
  if (onApp && loading === 0 && (await page.locator("main, header, nav").count()) > 0) {
    await page.waitForTimeout(4000);
    await page.screenshot({ path: "after-login.png" });
    console.log("SIGNED_IN", page.url());
    break;
  }
  await page.waitForTimeout(2000);
}
await ctx.close();
