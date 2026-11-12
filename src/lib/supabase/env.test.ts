import { ESLint } from "eslint";
import { describe, expect, test } from "vitest";
import { readPublicEnv, readServiceRoleKey } from "./env";

const good = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc123.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc",
};

describe("readPublicEnv", () => {
  test("returns the URL and key when both are set", () => {
    expect(readPublicEnv(good)).toEqual({
      url: "https://abc123.supabase.co",
      publishableKey: "sb_publishable_abc",
    });
  });

  test("returns null when Supabase is not configured at all", () => {
    expect(readPublicEnv({})).toBeNull();
    expect(
      readPublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" }),
    ).toBeNull();
  });

  test("names the variable when only one of the two is set", () => {
    expect(() => readPublicEnv({ NEXT_PUBLIC_SUPABASE_URL: good.NEXT_PUBLIC_SUPABASE_URL })).toThrow(
      /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/,
    );
  });

  test("rejects a URL that is not https", () => {
    expect(() => readPublicEnv({ ...good, NEXT_PUBLIC_SUPABASE_URL: "abc123.supabase.co" })).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
  });

  test("refuses a secret key in the public slot", () => {
    expect(() =>
      readPublicEnv({ ...good, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_oops" }),
    ).toThrow(/secret/i);
  });
});

describe("readServiceRoleKey", () => {
  test("returns the key when set", () => {
    expect(readServiceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: "sb_secret_x" })).toBe("sb_secret_x");
  });
  test("names the variable when missing, without printing any value", () => {
    expect(() => readServiceRoleKey({})).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("the service-role client can only be imported where it is allowed", () => {
  const eslint = new ESLint();
  const code = 'import { createAdminClient } from "@/lib/supabase/admin";\nexport const x = createAdminClient;\n';

  async function errorsFor(filePath: string) {
    const [result] = await eslint.lintText(code, { filePath });
    return (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-imports");
  }

  test.each([
    "src/features/sales/actions.ts",
    "src/components/shell/app-shell.tsx",
    "src/app/(app)/demo/page.tsx",
    "src/lib/workspace.ts",
  ])("%s may not import it", async (file) => {
    expect(await errorsFor(file)).toHaveLength(1);
  }, 30_000);

  test.each([
    "src/app/api/webhooks/yoco/route.ts",
    "src/features/account/delete-account.ts",
    "supabase/functions/outbox-worker/index.ts",
  ])("%s may import it", async (file) => {
    expect(await errorsFor(file)).toHaveLength(0);
  }, 30_000);
});
