import type { SVGProps } from "react";

/**
 * The ASC (Atlas Scale Collective) mark: two triangles on green. Redrawn as a vector from the supplied logo sheet,
 * using the compact "Small" version, which stays readable from 16 px up. `plain` drops the green square, for use on
 * a background that is already green.
 */
export function LogoMark({ className = "size-8", plain = false, ...rest }: { className?: string; plain?: boolean } & Omit<SVGProps<SVGSVGElement>, "className">) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden className={`${className} shrink-0`} {...rest}>
      {!plain && <rect width="100" height="100" rx="22" fill="#176e56" />}
      <polygon points="62,13 34,80 95,80" fill="#f2f0e8" stroke="#f2f0e8" strokeWidth="3" strokeLinejoin="round" />
      <polygon points="29,44 6,80 55,80" fill="#e8d6b0" stroke="#176e56" strokeWidth="3" strokeLinejoin="round" paintOrder="stroke" />
    </svg>
  );
}

/** "LEDGERLY" with a much smaller "by ASC" beneath it, on the right. */
export function Wordmark({ className = "", mark = true, markClass = "size-8" }: { className?: string; mark?: boolean; markClass?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`} aria-label="Ledgerly by ASC">
      {mark && <LogoMark className={markClass} />}
      <span aria-hidden className="flex flex-col leading-none">
        <span className="text-lg font-bold tracking-[0.18em]">LEDGERLY</span>
        <span className="mt-0.5 self-end text-[0.6rem] font-medium tracking-[0.28em] opacity-70">by ASC</span>
      </span>
    </span>
  );
}
