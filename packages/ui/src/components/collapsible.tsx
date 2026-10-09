import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { cn } from "cn";

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />;
}

/**
 * Height-animated panel. Like a native `<details>`, closed content stays in the DOM (hidden)
 * unless `keepMounted` is false, which unmounts it once the closing animation ends.
 * Clipping (not scrolling) keeps a 6px margin so focus rings at the edges stay visible.
 * Reduced-motion preferences skip the animation.
 */
function CollapsibleContent({
  className,
  keepMounted = true,
  ...props
}: Omit<CollapsiblePrimitive.Panel.Props, "className"> & { className?: string }) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      keepMounted={keepMounted}
      className={cn(
        "h-(--collapsible-panel-height) overflow-clip transition-[height,opacity] [overflow-clip-margin:6px] duration-200 ease-out data-ending-style:h-0 data-ending-style:opacity-0 data-starting-style:h-0 data-starting-style:opacity-0 motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
