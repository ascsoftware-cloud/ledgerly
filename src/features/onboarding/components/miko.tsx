/** Miko the meerkat: stands up, keeps watch, says one short thing. */
export function Miko({ line }: { line: string }) {
  return (
    <div className="flex items-end gap-3">
      <svg
        viewBox="0 0 64 64"
        aria-hidden
        className="size-14 shrink-0 motion-safe:animate-[miko-bob_2.4s_ease-in-out_infinite]"
      >
        <ellipse cx="32" cy="50" rx="13" ry="12" fill="#c8a47a" />
        <ellipse cx="32" cy="52" rx="8" ry="8" fill="#efdcc0" />
        <circle cx="19" cy="16" r="4" fill="#8a6a48" />
        <circle cx="45" cy="16" r="4" fill="#8a6a48" />
        <ellipse cx="32" cy="24" rx="14" ry="13" fill="#d7b58b" />
        <ellipse cx="25.5" cy="22" rx="4.5" ry="5" fill="#5b432d" />
        <ellipse cx="38.5" cy="22" rx="4.5" ry="5" fill="#5b432d" />
        <circle cx="26" cy="21.5" r="2" fill="#fff" />
        <circle cx="39" cy="21.5" r="2" fill="#fff" />
        <circle cx="26.4" cy="21.8" r="1" fill="#1b1410" />
        <circle cx="39.4" cy="21.8" r="1" fill="#1b1410" />
        <ellipse cx="32" cy="29" rx="5" ry="4" fill="#efdcc0" />
        <ellipse cx="32" cy="27.6" rx="2" ry="1.4" fill="#1b1410" />
        <path d="M29.5 30.5q2.5 2 5 0" fill="none" stroke="#1b1410" strokeWidth="1" strokeLinecap="round" />
      </svg>
      <p
        role="status"
        className="relative mb-2 rounded-2xl rounded-bl-sm border bg-card px-4 py-2.5 text-sm font-medium shadow-card"
      >
        {line}
      </p>
    </div>
  );
}
