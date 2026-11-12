/** The public address of the app, used in sign-in links. Required in production. */
export function siteUrl(): string {
  const url = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (url) return url.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") throw new Error("NEXT_PUBLIC_SITE_URL is not set");
  return "http://localhost:3000";
}
