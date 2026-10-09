import { cn } from "cn";
import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from "react";

const duration = 220;

/**
 * Height-animated disclosure panel for conditionally rendered content.
 *
 * Opening mounts the content and grows it from zero height; closing keeps the last open
 * content mounted until the collapse finishes, then unmounts it. The animated element is the
 * panel itself, so its id/role/aria attributes describe exactly what is visible. Reduced-motion
 * preferences skip the animation.
 */
export function AnimatedCollapse({
  open,
  children,
  className,
  innerClassName,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  open: boolean;
  children: ReactNode;
  innerClassName?: string;
}) {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);
  const lastOpen = useRef<ReactNode>(children);
  if (open) lastOpen.current = children;
  useEffect(() => {
    if (open) {
      setMounted(true);
      // Paint the collapsed state once so the grid row can transition to its full height.
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
      return () => cancelAnimationFrame(frame);
    }
    setExpanded(false);
    const timer = window.setTimeout(() => setMounted(false), duration);
    return () => window.clearTimeout(timer);
  }, [open]);
  if (!open && !mounted) return null;
  return (
    <div
      {...props}
      data-state={expanded ? "open" : "closed"}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-[220ms] ease-out motion-reduce:transition-none",
        expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className,
      )}
    >
      <div className={cn("min-h-0 overflow-hidden", innerClassName)}>
        {open ? children : lastOpen.current}
      </div>
    </div>
  );
}
