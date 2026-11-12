import { defineConfig, devices } from "@playwright/test";

// Tests read the same local settings as the app (test-only admin helpers need them).
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: tests that need Supabase admin access skip themselves.
}

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    // Tests never send real email.
    env: { EMAIL_TRANSPORT: "log" },
  },
});
