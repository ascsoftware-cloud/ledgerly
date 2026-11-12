import Link from "next/link";
import { Mail } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { GoogleButton } from "@/features/auth/components/google-button";

/** The last screen: sign in to keep the workspace. The only typing in the whole flow is an email. */
export function SaveStep() {
  return (
    <div className="space-y-3">
      <GoogleButton next="/welcome" />
      <Link
        href="/login?method=email&next=%2Fwelcome"
        prefetch={false}
        className={buttonVariants({ size: "touch", className: "h-14 w-full" })}
      >
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
