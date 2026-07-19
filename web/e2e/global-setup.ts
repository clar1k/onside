import { execSync } from "child_process";
import path from "path";

// Seed a fresh batch of markets on devnet with a 60s betting window so a single
// e2e run can bet (while open) and then settle/claim (after it closes).
export default async function globalSetup() {
  const clientDir = path.join(__dirname, "..", "..", "client");
  // eslint-disable-next-line no-console
  console.log("[e2e] seeding fresh markets (120s window) via", clientDir);
  execSync("npx ts-node src/create-markets.ts", {
    cwd: clientDir,
    env: { ...process.env, FIXTURE_ID: "17926615", PERIOD: "0", CLOSE_SEC: "120" },
    stdio: "inherit",
  });
}
