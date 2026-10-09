import { cn } from "cn";

/**
 * Keycade's mark: a keystone arch, read as both "key" and "arcade". Decorative only;
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
        <path d="M10 23.5v-7.25a6 6 0 0 1 12 0v7.25" strokeWidth="2.4" />
        <path d="M7.5 23.5h17" strokeWidth="2.4" />
      </g>
      <path
        d="M14.4 7.2h3.2l-.65 3.6h-1.9z"
        className={tone === "brand" ? "fill-brand-foreground" : "fill-brand"}
      />
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
