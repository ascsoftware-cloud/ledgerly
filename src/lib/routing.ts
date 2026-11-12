/** Top-level paths that belong to the app itself. Anything else is a workspace slug or a 404. */
export const APP_ROUTES = new Set([
  "",
  "start",
  "login",
  "auth",
  "welcome",
  "demo",
  "styleguide",
  "privacy",
  "terms",
  "popia",
  "api",
  "_next",
]);

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isWorkspaceSlug(segment: string): boolean {
  return segment.length >= 3 && segment.length <= 40 && SLUG.test(segment) && !APP_ROUTES.has(segment);
}

/** What the proxy should do with a path before any page renders. */
export function classifyPath(pathname: string): "app" | "workspace" | "not-found" {
  const first = pathname.split("/")[1] ?? "";
  if (APP_ROUTES.has(first)) return "app";
  return isWorkspaceSlug(first) ? "workspace" : "not-found";
}
