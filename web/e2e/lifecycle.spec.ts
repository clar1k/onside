import { test, expect, Page } from "@playwright/test";

const FIXTURE = "/fixture/17926615";

async function balance(page: Page): Promise<number> {
  return parseFloat((await page.getByTestId("balance").textContent()) || "0");
}

test("full lifecycle on devnet: load → fund → validate → bet → settle → claim", async ({
  page,
}) => {
  // enable the guest (in-browser devnet) wallet so the run has a signer — same path
  // a judge takes via "Connect wallet → Continue as guest", without the UI clicks.
  await page.addInitScript(() => localStorage.setItem("onside_guest_v1", "1"));

  // --- real TxODDS data ---
  await page.goto(FIXTURE);
  await expect(page.getByTestId("yes-btn").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Colombia", { exact: true })).toBeVisible();
  await expect(page.getByText("Congo DR", { exact: true })).toBeVisible();

  // --- fund from treasury (real devnet SOL) ---
  await page.getByTestId("fund-btn").click();
  await expect.poll(() => balance(page), { timeout: 45_000 }).toBeGreaterThan(0);

  // --- open the first market ---
  await page.getByTestId("yes-btn").first().click();
  await expect(page.getByTestId("place-btn")).toBeVisible();

  // edge case: empty amount is rejected
  await page.getByTestId("amount-input").fill("");
  await expect(page.getByTestId("place-btn")).toBeDisabled();
  await expect(page.getByTestId("place-btn")).toContainText(/enter an amount/i);

  // edge case: amount over balance is rejected
  await page.getByTestId("amount-input").fill("999");
  await expect(page.getByText(/not enough balance/i)).toBeVisible();
  await expect(page.getByTestId("place-btn")).toBeDisabled();

  // --- place a real bet ---
  await page.getByTestId("amount-input").fill("0.05");
  const beforeBet = await balance(page);
  await page.getByTestId("place-btn").click();
  // money actually moved on-chain
  await expect.poll(() => balance(page), { timeout: 45_000 }).toBeLessThan(beforeBet);
  // position is reflected in the trade panel
  await expect(page.getByText("Your bet")).toBeVisible({ timeout: 20_000 });
  const afterBet = await balance(page);

  // --- wait for the betting window to close, then settle from the Merkle proof ---
  const settle = page.getByTestId("settle-btn").first();
  await expect(settle).toBeVisible({ timeout: 140_000 });
  await settle.click();
  await expect(page.getByText(/resolved/i).first()).toBeVisible({ timeout: 60_000 });

  // --- winnings auto-claim silently (no button); balance rises on its own ---
  await expect.poll(() => balance(page), { timeout: 60_000 }).toBeGreaterThan(afterBet);
});
