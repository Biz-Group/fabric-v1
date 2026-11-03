"use client";

import { useQuery } from "convex/react";
import { useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, AtSign, Square } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { activeMentions, deleteMentionBefore, insertMention, mentionSegments, plainText } from "./mention-text";

export type Mention =
  | { kind: "function"; id: Id<"functions">; name: string }
  | { kind: "department"; id: Id<"departments">; name: string }
  | { kind: "process"; id: Id<"processes">; name: string };

const MAX_MENTIONS = 10;

/** Shared by the textarea and its highlight layer, which must wrap identically. */
const FIELD =
  "whitespace-pre-wrap break-words px-3 pt-3 pb-1 font-sans text-base leading-normal tracking-normal [scrollbar-gutter:stable] md:text-sm";
export const MAX_QUESTION_CHARS = 8_000;

/**
 * The `@` picker over functions, departments and processes (FR-4.3), from the
 * same member-level queries the command palette uses. Only loaded when open.
 */
function MentionPicker({ onPick }: { onPick: (mention: Mention) => void }) {
  const functions = useQuery(api.functions.list);
  const departments = useQuery(api.departments.listAll);
  const processes = useQuery(api.processes.listAll);
  const loading = functions === undefined || departments === undefined || processes === undefined;
  return (
    <Command>
      <CommandInput placeholder="Mention a process, department or function…" autoFocus />
      <CommandList>
        <CommandEmpty>{loading ? "Loading…" : "No matches."}</CommandEmpty>
        {processes && processes.length > 0 && (
          <CommandGroup heading="Processes">
            {processes.map((p) => (
              <CommandItem
                key={p._id}
                value={`${p.name} ${p.departmentName} ${p.functionName} ${p._id}`}
                onSelect={() => onPick({ kind: "process", id: p._id, name: p.name })}
              >
                <span className="truncate">{p.name}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">{p.departmentName}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {departments && departments.length > 0 && (
          <CommandGroup heading="Departments">
            {departments.map((d) => (
              <CommandItem
                key={d._id}
                value={`${d.name} ${d.functionName} ${d._id}`}
                onSelect={() => onPick({ kind: "department", id: d._id, name: d.name })}
              >
                <span className="truncate">{d.name}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">{d.functionName}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {functions && functions.length > 0 && (
          <CommandGroup heading="Functions">
            {functions.map((f) => (
              <CommandItem key={f._id} value={`${f.name} ${f._id}`} onSelect={() => onPick({ kind: "function", id: f._id, name: f.name })}>
                {f.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

/**
 * The question box (FR-4.3): Enter sends, Shift+Enter breaks the line, `@`
 * opens the mention picker, and while an answer streams the send button
 * becomes Stop (FR-2.2, FR-2.4).
 */
export function AskComposer({
  streaming,
  disabled,
  onSend,
  onStop,
  autoFocus,
}: {
  streaming: boolean;
  disabled?: boolean;
  onSend: (text: string, mentions: Mention[]) => Promise<boolean>;
  onStop: () => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  // Every entity picked in this draft; only those whose token is still in the
  // text are sent (`activeMentions`).
  const [picked, setPicked] = useState<Mention[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const mentions = activeMentions(picked, text);
  const names = mentions.map((mention) => mention.name);
  const question = plainText(text).trim();
  const canSend = !streaming && !sending && !disabled && question.length > 0 && question.length <= MAX_QUESTION_CHARS;

  const placeCaret = (caret: number) =>
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
    });

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      if (await onSend(question, mentions)) {
        setText("");
        setPicked([]);
      }
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const pick = (mention: Mention) => {
    setPickerOpen(false);
    const alreadyIn = mentions.some((m) => m.id === mention.id);
    if (!alreadyIn && mentions.length >= MAX_MENTIONS) return;
    const next = insertMention(text, inputRef.current?.selectionStart ?? text.length, mention.name);
    setText(next.text);
    setPicked((current) => (current.some((m) => m.id === mention.id) ? current : [...current, mention]));
    placeCaret(next.caret);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
      return;
    }
    // A mention deletes as one unit.
    const input = event.currentTarget;
    if (event.key === "Backspace" && input.selectionStart === input.selectionEnd) {
      const next = deleteMentionBefore(text, input.selectionStart, names);
      if (next) {
        event.preventDefault();
        setText(next.text);
        placeCaret(next.caret);
      }
    }
  };

  return (
    <div ref={boxRef} className="rounded-xl border bg-background shadow-xs focus-within:ring-2 focus-within:ring-ring/40">
      {/*
        Inline mention chips over a plain textarea: the textarea's own text is
        transparent (its caret and selection still show), and the layer behind
        renders the same text with each mention tinted. Both share padding,
        font, line height and scrollbar gutter, so they wrap identically.
      */}
      <div className="relative">
        <div
          ref={backdropRef}
          aria-hidden
          className={cn(FIELD, "pointer-events-none absolute inset-0 overflow-hidden text-foreground")}
        >
          {mentionSegments(text, names).map((segment, index) =>
            segment.mention ? (
              <span
                key={index}
                className="rounded-[4px] bg-org-accent-subtle text-org-accent-selected-foreground ring-1 ring-org-accent-border [box-decoration-break:clone]"
              >
                {segment.text}
              </span>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
          {/* Keeps a trailing newline's line box, as the textarea does. */}
          {"​"}
        </div>
        <textarea
          ref={inputRef}
          value={text}
          autoFocus={autoFocus}
          rows={1}
          maxLength={MAX_QUESTION_CHARS}
          placeholder="Ask about how your organization works…"
          aria-label="Ask AskFabric"
          className={cn(
            FIELD,
            "relative block field-sizing-content max-h-48 min-h-12 w-full resize-none overflow-y-auto bg-transparent text-transparent caret-foreground outline-none placeholder:text-muted-foreground selection:bg-primary/25",
          )}
          onScroll={(event) => {
            if (backdropRef.current) backdropRef.current.scrollTop = event.currentTarget.scrollTop;
          }}
          onChange={(event) => {
            const next = event.target.value;
            const caret = event.target.selectionStart ?? next.length;
            setText(next);
            // "@" typed at the start or after a space opens the picker.
            if (next.length > text.length && /(^|\s)@$/.test(next.slice(0, caret))) setPickerOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="flex items-center justify-between gap-2 px-2 pb-2">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Mention a process, department or function"
            onClick={() => setPickerOpen(true)}
          >
            <AtSign className="size-4" aria-hidden />
          </Button>
          {/* Closing returns focus to the textarea, not the @ button, so typing carries on after a pick. */}
          <PopoverContent anchor={boxRef} side="top" align="start" className="w-80 p-0" finalFocus={inputRef}>
            {pickerOpen && <MentionPicker onPick={pick} />}
          </PopoverContent>
        </Popover>
        <div className="flex items-center gap-2">
          {question.length > MAX_QUESTION_CHARS * 0.9 && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {question.length.toLocaleString()} / {MAX_QUESTION_CHARS.toLocaleString()}
            </span>
          )}
          {streaming ? (
            <Button type="button" size="icon-sm" variant="secondary" aria-label="Stop" onClick={onStop}>
              <Square className="size-3.5 fill-current" aria-hidden />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon-sm"
              aria-label="Send"
              disabled={!canSend}
              className={cn(!canSend && "opacity-50")}
              onClick={() => void send()}
            >
              <ArrowUp className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
