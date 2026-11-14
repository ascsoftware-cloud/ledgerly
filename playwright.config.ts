import { defineConfig, devices } from "@playwright/test";

// Tests read the same local settings as the app (test-only admin helpers need them).
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: tests that need Supabase admin access skip themselves.
}

const PORT = 3100;
// BASE_URL points the tests at a running site (a deployed one, for the smoke test) instead of building a local one.
const REMOTE = process.env.BASE_URL?.trim();

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: REMOTE ?? `http://localhost:${PORT}` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: REMOTE
    ? undefined
    : {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    // Tests never send real email.
    // PayFast sandbox demo values (public, from PayFast's documentation): nothing here can charge anyone.
    env: { EMAIL_TRANSPORT: "log", AI_PROVIDER: "mock", PAYFAST_MERCHANT_ID: "10000100", PAYFAST_MERCHANT_KEY: "46f0cd694581a", PAYFAST_PASSPHRASE: "e2e-test-passphrase", PAYFAST_MODE: "sandbox", JOBS_SECRET: "e2e-only-jobs-secret-0123456789abcdef", SHOPIFY_CLIENT_ID: "e2e-shopify-client-id", SHOPIFY_CLIENT_SECRET: "e2e-shopify-client-secret" },
  },
});
