import Link from "next/link";
import { Mail } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.300-2.100 3.500-5.200 3.500-8.700z" />
      <path fill="#34A853" d="M12 24c3.200 0 6-1.100 8-2.900l-3.900-3c-1.100.7-2.500 1.200-4.100 1.200-3.100 0-5.800-2.100-6.700-5H1.200v3.100A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.300 14.300a7.200 7.200 0 0 1 0-4.600V6.600H1.200a12 12 0 0 0 0 10.800l4.100-3.100z" />
      <path fill="#EA4335" d="M12 4.800c1.800 0 3.300.6 4.600 1.800l3.400-3.400A12 12 0 0 0 1.200 6.600l4.100 3.100c.900-2.900 3.600-4.900 6.700-4.900z" />
    </svg>
  );
}

/** The last screen: sign in to keep the workspace. The only typing in the whole flow is an email. */
export function SaveStep() {
  return (
    <div className="space-y-3">
      <Link
        href="/login?method=google"
        prefetch={false}
        className={buttonVariants({ variant: "outline", size: "touch", className: "h-14 w-full" })}
      >
        <GoogleMark />
        Continue with Google
      </Link>
      <Link href="/login?method=email" prefetch={false} className={buttonVariants({ size: "touch", className: "h-14 w-full" })}>
        <Mail className="size-5" aria-hidden />
        Continue with email
      </Link>
      <p className="pt-2 text-center text-sm text-muted-foreground">
        No password, ever. By continuing you agree to our{" "}
        <Link href="/terms" prefetch={false} className="underline underline-offset-4">
          terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" prefetch={false} className="underline underline-offset-4">
          privacy policy
        </Link>
        .
      </p>
    </div>
  );
}
