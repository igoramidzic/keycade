import { cn } from "cn";

/**
 * KeyLend's key symbol is decorative;
 * the adjacent wordmark supplies the accessible name.
 */
export function BrandMark({
  className,
  tone = "brand",
}: {
  className?: string;
  tone?: "brand" | "inverse";
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 32 32"
      className={cn("size-8 shrink-0", className)}
    >
      <rect
        width="32"
        height="32"
        rx="9"
        className={tone === "brand" ? "fill-brand" : "fill-brand-foreground"}
      />
      <g
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={tone === "brand" ? "stroke-brand-foreground" : "stroke-brand"}
      >
        <circle cx="11" cy="15" r="4.5" strokeWidth="2.4" />
        <path d="M15.5 15H26M22 15v5M26 15v3" strokeWidth="2.4" />
      </g>
    </svg>
  );
}

/** Logo lockup: mark plus a wordmark. The wordmark text is the accessible name. */
export function BrandLockup({
  name,
  detail,
  className,
}: {
  name: string;
  detail?: string;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <BrandMark />
      <span className="min-w-0 truncate text-[1.0625rem] font-semibold tracking-tight">{name}</span>
      {detail && (
        <span
          aria-hidden="true"
          className="hidden border-l pl-2.5 text-xs font-medium text-muted-foreground sm:inline"
        >
          {detail}
        </span>
      )}
    </span>
  );
}
