import { Button } from "@keycade/ui/components/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@keycade/ui/components/combobox";
import { useEffect, useState } from "react";

type Option = { code: string; title: string };
type SearchState<T> = { query: string; status: "loading" | "ready" | "error"; items: T[] };

/** Query state and the selected value are intentionally independent. */
export function SearchCombobox<T extends Option>({
  id,
  value,
  onSelect,
  search,
  disabled,
  invalid,
  describedBy,
}: {
  id: string;
  value: T | null;
  onSelect: (value: T) => void;
  search: (query: string) => Promise<T[]>;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SearchState<T>>({ query: "", status: "loading", items: [] });
  useEffect(() => {
    if (!open) return;
    let active = true;
    setState({ query, status: "loading", items: [] });
    // Rejected searches and late responses must not clear either query or selection.
    Promise.resolve()
      .then(() => search(query))
      .then(
        (items) => active && setState({ query, status: "ready", items }),
        () => active && setState({ query, status: "error", items: [] }),
      );
    return () => {
      active = false;
    };
  }, [open, query, attempt, search]);
  const current = state.query === query;
  const status = current ? state.status : "loading";
  const items = current && status === "ready" ? state.items : [];
  return (
    <Combobox
      open={open}
      onOpenChange={setOpen}
      value={value}
      onValueChange={(selected) => {
        if (selected) onSelect(selected);
      }}
      inputValue={query}
      onInputValueChange={(text, details) => {
        if (details.reason === "input-change") setQuery(text);
      }}
      items={items}
      filter={null}
      disabled={disabled}
      itemToStringLabel={(item: T) => item.title}
      isItemEqualToValue={(item: T, selected: T) => item.code === selected.code}
    >
      <ComboboxTrigger
        id={id}
        render={<Button type="button" variant="outline" />}
        className="h-auto min-h-11 w-full justify-between gap-3 whitespace-normal text-left"
        aria-invalid={invalid}
        aria-describedby={describedBy}
      >
        <span className="min-w-0 break-words">
          {value ? `${value.title} (${value.code})` : "Choose an industry"}
        </span>
      </ComboboxTrigger>
      <ComboboxContent className="min-w-0">
        <ComboboxInput
          aria-label="Search industries"
          placeholder="Business description or code"
          showTrigger={false}
          maxLength={120}
          autoComplete="off"
        />
        <div role="status" aria-live="polite" className="px-3 py-2 text-xs text-muted-foreground">
          {status === "loading"
            ? "Searching industries…"
            : status === "error"
              ? "Industry search is unavailable. Your search is kept."
              : items.length === 0
                ? "No matching industries. Try another description or skip for now."
                : `${items.length} results${items.length === 30 ? ". Type more to narrow your search" : ""}.`}
        </div>
        {status === "error" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="m-2"
            onClick={() => setAttempt((count) => count + 1)}
          >
            Retry industry search
          </Button>
        )}
        <ComboboxList aria-label="Industry results" aria-busy={status === "loading"}>
          {(item: T) => (
            <ComboboxItem key={item.code} value={item} className="min-h-10 items-start py-2">
              <span className="min-w-0 break-words">{item.title}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{item.code}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
