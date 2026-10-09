import { cn } from "cn";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Application chrome shared by the borrower portal and bank console.
 *
 * The header exposes a slot that signed-in workspaces fill through a portal, so account
 * controls live in the real banner while staying inside their workspace's React tree
 * (query clients, session callbacks and access guards keep working unchanged).
 */
const HeaderSlotContext = createContext<HTMLElement | null>(null);

export function useHeaderSlot() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const ref = useCallback((element: HTMLDivElement | null) => setSlot(element), []);
  return { slot, ref };
}

export function HeaderSlotProvider({
  slot,
  children,
}: {
  slot: HTMLElement | null;
  children: ReactNode;
}) {
  return <HeaderSlotContext.Provider value={slot}>{children}</HeaderSlotContext.Provider>;
}

/** Render children into the application header's account area when it is available. */
export function HeaderPortal({ children }: { children: ReactNode }) {
  const slot = useContext(HeaderSlotContext);
  return slot ? createPortal(children, slot) : null;
}

export const shellWidth = "mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8";

export function AppHeader({
  brand,
  aside,
  slotRef,
  className,
}: {
  brand: ReactNode;
  aside?: ReactNode;
  slotRef?: (element: HTMLDivElement | null) => void;
  className?: string;
}) {
  return (
    <header className={cn("border-b bg-card/95", className)}>
      <div
        className={cn(
          shellWidth,
          "flex min-h-16 flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3",
        )}
      >
        {brand}
        <div
          className={cn(
            "flex min-w-0 flex-wrap items-center justify-end gap-3 max-sm:w-full",
            !aside && "max-sm:has-[>[data-header-slot]:empty]:hidden",
          )}
        >
          {aside}
          <div ref={slotRef} data-header-slot="" className="contents" />
        </div>
      </div>
    </header>
  );
}

export function AppFooter({ children }: { children?: ReactNode }) {
  return (
    <footer className="border-t bg-card/60">
      <div
        className={cn(
          shellWidth,
          "flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-5 text-xs leading-5 text-muted-foreground",
        )}
      >
        {children ?? (
          <p>
            Synthetic lending demo · Use fictional information only. No real credit decisions or
            money movement.
          </p>
        )}
      </div>
    </footer>
  );
}

/** Initials avatar for the signed-in person. Decorative; the email is shown beside it. */
export function IdentityAvatar({ email, className }: { email: string; className?: string }) {
  const initials = useMemo(() => {
    const local = email.split("@")[0] ?? "";
    const parts = local.split(/[^a-z0-9]+/i).filter(Boolean);
    const letters = (parts.length > 1 ? `${parts[0]?.[0]}${parts[1]?.[0]}` : local.slice(0, 2))
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    return letters || "?";
  }, [email]);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full bg-info-soft text-xs font-semibold text-info",
        className,
      )}
    >
      {initials}
    </span>
  );
}
