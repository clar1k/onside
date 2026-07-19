import { defineConfig } from "@playwright/test";

// Real e2e against Solana devnet — no mocks. Uses real treasury SOL, real TxODDS
// data + Merkle proofs. globalSetup seeds a fresh market batch with a short
// betting window so the full bet → settle → claim lifecycle runs in one test.
export default defineConfig({
  testDir: "./e2e",
  timeout: 200_000,
  expect: { timeout: 25_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3100",
    actionTimeout: 25_000,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
