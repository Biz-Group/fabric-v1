"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { Combobox } from "@base-ui/react/combobox";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Spinner } from "@/components/ui/spinner";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { cn } from "@/lib/utils";
import {
  buildMemberOptions,
  isSameMember,
  type MemberOption,
} from "./speaker-member-options";

const SEARCH_LIMIT = 50;

/**
 * Links a speaker to a workspace member. Searches the whole workspace on the
 * server, so members beyond the first page can still be found.
 */
export function SpeakerMemberPicker({
  id,
  labelledBy,
  value,
  onChange,
}: {
  id: string;
  labelledBy: string;
  value: MemberOption;
  onChange: (member: MemberOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim(), 250);
  const results = useQuery(
    api.users.searchOrgMembers,
    open ? { search: search || undefined, limit: SEARCH_LIMIT } : "skip",
  );
  // Keep showing the last results while the next search loads, so the list
  // doesn't collapse on every keystroke.
  const [lastResults, setLastResults] = useState<MemberOption[]>([]);
  if (results !== undefined && results !== lastResults) {
    setLastResults(results);
  }
  const shown = results ?? lastResults;
  const searching = open && (results === undefined || search !== query.trim());
  const options = buildMemberOptions(shown, value);
  const noMatches = !searching && search !== "" && shown.length === 0;

  return (
    <Combobox.Root
      items={options}
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next);
      }}
      inputValue={query}
      onInputValueChange={setQuery}
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) setQuery("");
      }}
      filter={null}
      itemToStringLabel={(member: MemberOption) => member.name}
      isItemEqualToValue={isSameMember}
    >
      <Combobox.Trigger
        id={id}
        aria-labelledby={labelledBy}
        className="flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-left text-sm transition-colors select-none focus-ring pointer-coarse:min-h-10 dark:bg-input/30 dark:hover:bg-input/50"
      >
        <Combobox.Value>
          {(selected: MemberOption | null) => (
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                !selected?.userId && "text-muted-foreground",
              )}
            >
              {selected?.name ?? "No linked member"}
            </span>
          )}
        </Combobox.Value>
        <ChevronDownIcon
          aria-hidden
          className="pointer-events-none size-4 shrink-0 text-muted-foreground"
        />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner
          align="start"
          sideOffset={4}
          className="isolate z-popover"
        >
          <Combobox.Popup
            aria-busy={searching || undefined}
            className="flex max-h-[min(24rem,var(--available-height))] w-(--anchor-width) min-w-64 max-w-(--available-width) origin-(--transform-origin) flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          >
            <div className="flex items-center gap-2 border-b px-2.5">
              <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <Combobox.Input
                aria-label="Search members by name or email"
                placeholder="Search members"
                className="h-9 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground pointer-coarse:h-11 pointer-coarse:text-base"
              />
              {searching && <Spinner className="size-3.5 shrink-0" />}
            </div>
            <Combobox.Status className="empty:hidden">
              {noMatches ? (
                <p className="px-3 pt-2 text-xs text-muted-foreground">
                  No members match &ldquo;{search}&rdquo;.
                </p>
              ) : null}
            </Combobox.Status>
            <Combobox.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
              {(member: MemberOption) => (
                <Combobox.Item
                  key={member.userId ?? "none"}
                  value={member}
                  className="relative flex w-full cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-sm outline-hidden select-none pointer-coarse:min-h-10 data-highlighted:bg-org-accent-selected data-highlighted:text-org-accent-selected-foreground data-highlighted:**:text-org-accent-selected-foreground"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{member.name}</span>
                    {member.email && (
                      <span className="truncate text-xs text-muted-foreground">
                        {member.email}
                      </span>
                    )}
                  </span>
                  <Combobox.ItemIndicator className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
                    <CheckIcon className="size-4" />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
