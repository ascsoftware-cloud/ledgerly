/**
 * App-level credentials ASC registers once with each provider. Per-business credentials are
 * never here: those live in Vault. Each function returns null when the provider is not set up,
 * so the integrations page can say so instead of failing.
 */

export function xeroApp(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.XERO_CLIENT_ID?.trim();
  const clientSecret = process.env.XERO_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function shopifyApp(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.SHOPIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Sage issues one API key to the developer (ASC); each business signs in with its own login. */
export function sageApiKey(): string | null {
  return process.env.SAGE_API_KEY?.trim() || null;
}
