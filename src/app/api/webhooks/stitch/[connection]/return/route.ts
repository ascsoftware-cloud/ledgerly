import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/site-url";
import { rateLimit } from "@/lib/rate-limit";
import { confirmStitchCheckout } from "@/server/payments/checkout";

/**
 * Where Stitch sends the payer after a successful bank payment. The query string's own status is
 * never trusted: we ask Stitch for the payment request's real status, apply it once, then show
 * the invoice. If Stitch is slow to answer, the signed webhook still settles the invoice.
 */
export async function GET(
  req: Request,
  { params }: RouteContext<"/api/webhooks/stitch/[connection]/return">,
) {
  const { connection } = await params;
  const url = new URL(req.url);
  const checkout = url.searchParams.get("checkout") ?? "";
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await rateLimit("pay-return-ip", ip, 30, 3600))) {
    return new Response("Too many attempts. Try again later.", { status: 429 });
  }
  const { outcome, token } = await confirmStitchCheckout(connection, checkout);
  if (!token) return NextResponse.redirect(`${siteUrl()}/`, 303);
  // "Being confirmed" also covers Stitch not answering in time: the webhook settles it.
  const confirming = ["applied", "duplicate payment", "duplicate", "unavailable"].includes(outcome);
  return NextResponse.redirect(`${siteUrl()}/p/${token}${confirming ? "?paid=1" : ""}`, 303);
}
