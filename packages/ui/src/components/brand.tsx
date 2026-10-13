import { cn } from "cn";

const logoUrl = new URL("../assets/keybank-logo.svg", import.meta.url).href;

/** Locally bundled KeyBank artwork; keep its original proportions and colors. */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <img
      src={logoUrl}
      alt="KeyBank"
      width="394"
      height="69"
      className={cn(
        "h-auto w-36 shrink-0 dark:rounded-sm dark:bg-white dark:p-2 sm:w-40",
        className,
      )}
    />
  );
}

/** Bank identity with an optional product name and workspace description. */
export function BrandLockup({
  product,
  detail,
  className,
}: {
  product?: string;
  detail?: string;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-3", className)}>
      <BrandLogo />
      {product && (
        <span className="border-l pl-3 text-[1.0625rem] font-semibold tracking-tight">
          {product}
        </span>
      )}
      {detail && (
        <span
          aria-hidden="true"
          className="hidden border-l pl-3 text-xs font-medium text-muted-foreground sm:inline"
        >
          {detail}
        </span>
      )}
    </span>
  );
}
