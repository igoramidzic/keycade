import { Input } from "@keycade/ui/components/input";
import { cn } from "cn";
import { type ComponentProps, useLayoutEffect, useRef } from "react";

const maxDigits = 12;

/** Whole US dollars as plain digits: separators, cents and leading zeros removed. */
export function wholeDollars(value: string) {
  const [whole = ""] = value.split(".");
  return whole
    .replace(/\D/g, "")
    .replace(/^0+(?=\d)/, "")
    .slice(0, maxDigits);
}

/** Digits grouped with comma thousands separators, such as 1,250,000. */
export function groupDigits(digits: string) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * A whole-dollar amount field. It shows a dollar sign and comma separators while typing and
 * reports plain digits, so callers keep their own validation and decimal conversion.
 */
export function CurrencyInput({
  value,
  onValueChange,
  className,
  prefixClassName,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type" | "inputMode"> & {
  value: string;
  onValueChange: (digits: string) => void;
  prefixClassName?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  // Digits before the caret; regrouping must not move the caret past what was typed.
  const caretDigits = useRef<number | null>(null);
  const display = groupDigits(wholeDollars(value));
  useLayoutEffect(() => {
    const element = input.current;
    if (caretDigits.current === null || !element || document.activeElement !== element) return;
    let remaining = caretDigits.current;
    let index = 0;
    while (index < display.length && remaining > 0) {
      if (/\d/.test(display[index] ?? "")) remaining -= 1;
      index += 1;
    }
    element.setSelectionRange(index, index);
    caretDigits.current = null;
  });
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground",
          prefixClassName,
        )}
      >
        $
      </span>
      <Input
        ref={input}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className={cn("pl-7 tabular-nums", className)}
        value={display}
        onChange={(event) => {
          const { value: typed, selectionStart } = event.target;
          caretDigits.current = typed
            .slice(0, selectionStart ?? typed.length)
            .replace(/\D/g, "").length;
          onValueChange(wholeDollars(typed));
        }}
        {...props}
      />
    </div>
  );
}
