"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Id, Doc } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  AudioPlayerProvider,
  AudioPlayerButton,
  AudioPlayerProgress,
  AudioPlayerSkipButton,
  AudioPlayerSpeed,
  AudioPlayerTimeToggle,
  useAudioPlayer,
  useAudioPlayerTime,
} from "@/components/ui/audio-player";
import { AudioScrubber } from "@/components/ui/waveform";
import { ChevronRight, ArrowDown, ArrowUp, Download } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SpeakerLabelReview } from "@/features/recording/speaker-label-review";
import { StatusBadge } from "@/features/status/status-badge";
import { conversationStatusMeta } from "@/features/status/status-meta";
import { useConversationAudioUrl } from "@/features/conversations/use-conversation-audio-url";
import { ConversationFailureNotice } from "@/features/conversations/conversation-failure-notice";
import {
  controlsPositionFrom,
  scrollIntoNearestScroller,
  shouldDockMiniPlayer,
  type ControlsPosition,
} from "@/features/conversations/playback-layout";
import {
  transcriptKeyTarget,
  transcriptTabStop,
} from "@/features/conversations/transcript-navigation";
import { registerBottomDock } from "@/lib/bottom-dock";

// --- Helpers ---

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

// --- localStorage Hooks ---

function useListenedState(id: string) {
  const key = `fabric:listened:${id}`;
  const [listened, setListened] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });

  const markListened = useCallback(() => {
    if (listened) return;
    try {
      localStorage.setItem(key, "1");
    } catch {}
    setListened(true);
  }, [key, listened]);

  return [listened, markListened] as const;
}

function usePlaybackPosition(id: string) {
  const key = `fabric:position:${id}`;
  const lastSaveRef = useRef(0);

  const save = useCallback(
    (time: number) => {
      const now = Date.now();
      if (now - lastSaveRef.current < 5000) return;
      lastSaveRef.current = now;
      try {
        localStorage.setItem(key, String(time));
      } catch {}
    },
    [key]
  );

  const restore = useCallback(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? parseFloat(saved) : null;
    } catch {
      return null;
    }
  }, [key]);

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {}
  }, [key]);

  return { save, restore, clear };
}

// --- Types ---

interface TranscriptMessage {
  role: string;
  content: string;
  time_in_call_secs: number;
  speakerId?: string;
  speakerName?: string;
}

function transcriptSpeakerName(
  msg: TranscriptMessage,
  contributorName: string,
): string {
  return msg.speakerName ?? (msg.role === "ai" ? "Fabric" : contributorName);
}

// --- PDF Export ---

type PdfFont = "F1" | "F2";

interface PdfLine {
  text: string;
  x: number;
  y: number;
  size: number;
  font: PdfFont;
}

const PDF_PAGE_WIDTH = 612;
const PDF_PAGE_HEIGHT = 792;
const PDF_MARGIN = 54;
const PDF_BODY_SIZE = 10;

const PDF_TEXT_REPLACEMENTS: Record<string, string> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u2013": "-",
  "\u2014": "-",
  "\u2022": "-",
  "\u2026": "...",
  "\u00a0": " ",
};

function normalizeForPdf(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, (char) =>
      PDF_TEXT_REPLACEMENTS[char] ?? ""
    );
}

function estimatePdfTextWidth(text: string, size: number): number {
  let width = 0;
  for (const char of text) {
    if (char === " ") width += 0.28;
    else if (/[ilI.,'!:;]/.test(char)) width += 0.28;
    else if (/[mwMW@#%&]/.test(char)) width += 0.82;
    else if (/[A-Z0-9]/.test(char)) width += 0.62;
    else width += 0.5;
  }
  return width * size;
}

function splitLongPdfWord(word: string, maxWidth: number, size: number) {
  const parts: string[] = [];
  let current = "";

  for (const char of word) {
    const candidate = `${current}${char}`;
    if (current && estimatePdfTextWidth(candidate, size) > maxWidth) {
      parts.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }

  if (current) parts.push(current);
  return parts;
}

function wrapPdfText(text: string, maxWidth: number, size: number) {
  const words = text.replace(/[ \t]+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (estimatePdfTextWidth(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) lines.push(current);

    if (estimatePdfTextWidth(word, size) > maxWidth) {
      const parts = splitLongPdfWord(word, maxWidth, size);
      lines.push(...parts.slice(0, -1));
      current = parts[parts.length - 1] ?? "";
    } else {
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function escapePdfString(value: string): string {
  return normalizeForPdf(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function sanitizeFilenamePart(value: string): string {
  return (
    normalizeForPdf(value)
      .trim()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "contribution"
  );
}

function buildConversationPdfPages(
  conversation: Doc<"conversations">,
  transcript: TranscriptMessage[] | undefined
) {
  const pages: PdfLine[][] = [[]];
  let cursorY = PDF_PAGE_HEIGHT - PDF_MARGIN;

  const currentPage = () => pages[pages.length - 1];
  const newPage = () => {
    pages.push([]);
    cursorY = PDF_PAGE_HEIGHT - PDF_MARGIN;
  };

  const addLine = (
    text: string,
    {
      x = PDF_MARGIN,
      size = PDF_BODY_SIZE,
      font = "F1",
      lineHeight = size * 1.35,
      gapBefore = 0,
    }: {
      x?: number;
      size?: number;
      font?: PdfFont;
      lineHeight?: number;
      gapBefore?: number;
    } = {}
  ) => {
    let gap = gapBefore;
    if (cursorY - gap - lineHeight < PDF_MARGIN) {
      newPage();
      gap = 0;
    }

    cursorY -= gap;
    currentPage().push({
      text: normalizeForPdf(text),
      x,
      y: cursorY,
      size,
      font,
    });
    cursorY -= lineHeight;
  };

  const addWrappedText = (
    text: string,
    {
      x = PDF_MARGIN,
      size = PDF_BODY_SIZE,
      font = "F1",
      lineHeight = 14,
      gapBefore = 0,
    }: {
      x?: number;
      size?: number;
      font?: PdfFont;
      lineHeight?: number;
      gapBefore?: number;
    } = {}
  ) => {
    const normalized = normalizeForPdf(text);
    const blocks = normalized.trim() ? normalized.split(/\n{2,}/) : [""];
    const maxWidth = PDF_PAGE_WIDTH - PDF_MARGIN - x;
    let isFirstLine = true;

    for (const block of blocks) {
      const sourceLines = block.split("\n");
      for (const sourceLine of sourceLines) {
        const wrapped = wrapPdfText(sourceLine, maxWidth, size);
        for (const line of wrapped) {
          addLine(line || " ", {
            x,
            size,
            font,
            lineHeight,
            gapBefore: isFirstLine ? gapBefore : 0,
          });
          isFirstLine = false;
        }
      }
      addLine(" ", { x, size, font, lineHeight: 6 });
    }
  };

  const addSectionHeading = (title: string) => {
    addLine(title, { size: 12, font: "F2", lineHeight: 16, gapBefore: 12 });
  };

  addLine("Contribution Export", { size: 18, font: "F2", lineHeight: 24 });
  // The analysis title, when there is one. The export is read outside the app,
  // where "Contribution Export" on its own names nothing.
  if (conversation.title?.trim()) {
    addLine(conversation.title.trim(), {
      size: 11,
      font: "F2",
      lineHeight: 15,
      gapBefore: 4,
    });
  }
  addLine(`Contributor: ${conversation.contributorName}`, {
    size: 9,
    lineHeight: 12,
    gapBefore: 3,
  });
  // Only on rows filed for someone else. The export leaves the client's hands,
  // so the distinction between subject and submitter has to travel with it.
  if (conversation.submittedByName) {
    addLine(`Submitted by: ${conversation.submittedByName}`, {
      size: 9,
      lineHeight: 12,
    });
  }
  addLine(`Recorded: ${formatDate(conversation._creationTime)}`, {
    size: 9,
    lineHeight: 12,
  });
  if (conversation.durationSeconds != null) {
    addLine(`Duration: ${formatDuration(conversation.durationSeconds)}`, {
      size: 9,
      lineHeight: 12,
    });
  }

  addSectionHeading("Summary");
  addWrappedText(
    conversation.summary?.trim() || "No summary available.",
    { gapBefore: 2 }
  );

  addSectionHeading("Transcript");
  if (!transcript || transcript.length === 0) {
    addWrappedText("No transcript available.", { gapBefore: 2 });
  } else {
    transcript.forEach((msg, index) => {
      const speaker = transcriptSpeakerName(msg, conversation.contributorName);
      addWrappedText(`[${formatDuration(msg.time_in_call_secs)}] ${speaker}`, {
        font: "F2",
        lineHeight: 13,
        gapBefore: index === 0 ? 2 : 8,
      });
      addWrappedText(msg.content, {
        x: PDF_MARGIN + 12,
        lineHeight: 14,
      });
    });
  }

  return pages;
}

function createPdfBlob(pages: PdfLine[][]): Blob {
  const encoder = new TextEncoder();
  const pageObjectIds = pages.map((_, index) => 3 + index * 2);
  const contentObjectIds = pages.map((_, index) => 4 + index * 2);
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectIds
      .map((id) => `${id} 0 R`)
      .join(" ")}] /Count ${pages.length} >>`,
  ];

  pages.forEach((page, index) => {
    const content = page
      .map(
        (line) =>
          `BT /${line.font} ${line.size} Tf ${line.x.toFixed(2)} ${line.y.toFixed(
            2
          )} Td (${escapePdfString(line.text)}) Tj ET`
      )
      .join("\n");
    const contentLength = encoder.encode(content).length;

    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >> >> /Contents ${contentObjectIds[index]} 0 R >>`
    );
    objects.push(`<< /Length ${contentLength} >>\nstream\n${content}\nendstream`);
  });

  const chunks: string[] = [];
  const offsets: number[] = [0];
  let byteOffset = 0;
  const append = (chunk: string) => {
    chunks.push(chunk);
    byteOffset += encoder.encode(chunk).length;
  };

  append("%PDF-1.4\n");
  objects.forEach((body, index) => {
    const objectNumber = index + 1;
    offsets[objectNumber] = byteOffset;
    append(`${objectNumber} 0 obj\n${body}\nendobj\n`);
  });

  const xrefOffset = byteOffset;
  append(`xref\n0 ${objects.length + 1}\n`);
  append("0000000000 65535 f \n");
  for (let i = 1; i <= objects.length; i++) {
    append(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  append(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  );

  return new Blob(chunks, { type: "application/pdf" });
}

function downloadConversationPdf(
  conversation: Doc<"conversations">,
  transcript: TranscriptMessage[] | undefined
) {
  const pages = buildConversationPdfPages(conversation, transcript);
  const blob = createPdfBlob(pages);
  const date = new Date(conversation._creationTime).toISOString().slice(0, 10);
  const filename = `${sanitizeFilenamePart(
    conversation.contributorName
  )}-${date}-contribution.pdf`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// --- Waveform Data ---

function useTranscriptWaveform(
  transcript: TranscriptMessage[] | undefined,
  durationSeconds: number | undefined
) {
  return useMemo(() => {
    if (!transcript || !durationSeconds || durationSeconds <= 0) return [];
    const buckets = 60;
    const bucketSize = durationSeconds / buckets;
    // Accumulate speech density per bucket
    const raw = new Array(buckets).fill(0);
    for (const msg of transcript) {
      const idx = Math.min(
        buckets - 1,
        Math.floor(msg.time_in_call_secs / bucketSize)
      );
      raw[idx] += 1 + msg.content.length * 0.005;
    }
    // Normalize to 0-1 range
    const max = Math.max(...raw, 1);
    const normalized = raw.map((v) => v / max);
    // Smooth with neighbors for a natural look
    const smoothed = normalized.map((v, i) => {
      const prev = normalized[i - 1] ?? v;
      const next = normalized[i + 1] ?? v;
      return prev * 0.2 + v * 0.6 + next * 0.2;
    });
    // Map to a comfortable visual range (0.15 – 0.7)
    return smoothed.map((v) => 0.15 + v * 0.55);
  }, [transcript, durationSeconds]);
}

// --- Per-Conversation Audio Controls ---

function ConversationAudioControls({
  conversationId,
  audioUrl,
  durationSeconds,
  transcript,
  contributorName,
  onListened,
}: {
  conversationId: Id<"conversations">;
  audioUrl: string | null;
  durationSeconds?: number;
  transcript?: TranscriptMessage[];
  contributorName: string;
  onListened?: () => void;
}) {
  const player = useAudioPlayer();
  const time = useAudioPlayerTime();
  const isActive = player.isItemActive(conversationId);
  const waveformData = useTranscriptWaveform(transcript, durationSeconds);
  const position = usePlaybackPosition(String(conversationId));
  const restoredRef = useRef(false);
  const listenedRef = useRef(false);

  // The focused playback panel reuses this instance across conversations, so
  // reset the per-conversation flags when the conversation changes — otherwise
  // a prior conversation's "listened" state suppresses tracking for the new one.
  useEffect(() => {
    restoredRef.current = false;
    listenedRef.current = false;
  }, [conversationId]);

  // Save playback position periodically & track listened state
  useEffect(() => {
    if (!isActive) {
      restoredRef.current = false;
      return;
    }
    if (time > 0) position.save(time);
    const dur = player.duration ?? durationSeconds ?? 0;
    if (dur > 0 && time / dur > 0.8 && !listenedRef.current) {
      listenedRef.current = true;
      position.clear();
      onListened?.();
    }
  }, [isActive, time, player.duration, durationSeconds, position, onListened]);

  // Restore saved position when becoming active
  useEffect(() => {
    if (isActive && !restoredRef.current) {
      restoredRef.current = true;
      const saved = position.restore();
      if (saved && saved > 1) {
        player.seek(saved);
      }
    }
  }, [isActive, player, position]);

  const item = useMemo(
    () => ({ id: conversationId, src: audioUrl ?? "", data: { contributorName } }),
    [conversationId, audioUrl, contributorName]
  );

  if (!audioUrl) return null;

  return (
    <div className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden">
      <AudioPlayerSkipButton
        seconds={-10}
        variant="ghost"
        size="icon"
        onClick={() => {
          if (!isActive) player.play(item);
        }}
      />
      {/* The mini-player's "Show playback controls" hands focus here. */}
      <AudioPlayerButton
        item={item}
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        data-playback-toggle
      />
      <AudioPlayerSkipButton
        seconds={10}
        variant="ghost"
        size="icon"
        onClick={() => {
          if (!isActive) player.play(item);
        }}
      />
      {isActive && waveformData.length > 0 ? (
        <AudioScrubber
          data={waveformData}
          currentTime={time}
          duration={player.duration ?? durationSeconds ?? 0}
          onSeek={(t) => player.seek(t)}
          height={24}
          barWidth={2}
          barGap={2}
          barRadius={1}
          showHandle={false}
          className="min-w-0 flex-1 overflow-hidden"
        />
      ) : waveformData.length > 0 ? (
        <AudioScrubber
          data={waveformData}
          currentTime={0}
          duration={durationSeconds ?? 1}
          onSeek={(t) => {
            player.play(item).then(() => player.seek(t));
          }}
          height={24}
          barWidth={2}
          barGap={2}
          barRadius={1}
          showHandle={false}
          className="min-w-0 flex-1 overflow-hidden"
        />
      ) : isActive ? (
        <AudioPlayerProgress className="min-w-0 flex-1" />
      ) : (
        <div className="flex h-4 min-w-0 flex-1 items-center overflow-hidden">
          <div className="h-[4px] w-full rounded-full bg-muted" />
        </div>
      )}
      <AudioPlayerSpeed
        speeds={[1, 1.5, 2]}
        variant="ghost"
        size="icon"
        className="shrink-0"
      />
      {isActive ? (
        <AudioPlayerTimeToggle className="shrink-0 text-xs" />
      ) : (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {durationSeconds != null ? formatDuration(durationSeconds) : "--:--"}
        </span>
      )}
    </div>
  );
}

// --- Synced Transcript ---

function SyncedTranscript({
  conversationId,
  transcript,
  contributorName,
  audioUrl,
  expanded = false,
}: {
  conversationId: Id<"conversations">;
  transcript: TranscriptMessage[];
  contributorName: string;
  audioUrl: string | null;
  expanded?: boolean;
}) {
  const player = useAudioPlayer();
  const time = useAudioPlayerTime();
  const isActive = player.isItemActive(conversationId);
  const [userToggled, setUserToggled] = useState(false);
  const [open, setOpen] = useState(expanded);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const prevIndexRef = useRef(-1);
  const autoOpen = !expanded && isActive && player.isPlaying && !userToggled;
  const collapsibleOpen = open || autoOpen;

  // Derive active message index from playback time
  const activeIndex = useMemo(() => {
    if (!isActive || !player.isPlaying) return -1;
    let idx = -1;
    for (let i = 0; i < transcript.length; i++) {
      if (transcript[i].time_in_call_secs <= time) idx = i;
      else break;
    }
    return idx;
  }, [isActive, player.isPlaying, transcript, time]);

  useEffect(() => {
    if (!isActive && userToggled) {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setUserToggled(false);
      });
      return () => {
        cancelled = true;
      };
    }
  }, [isActive, userToggled]);

  // The transcript is one tab stop: only one line's "Play from" button is in
  // the tab order, and Up/Down move between lines (transcript-navigation.ts).
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [lastFocusedIndex, setLastFocusedIndex] = useState(0);
  const seekButtonRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const lineIdPrefix = useId();
  const tabStop = transcriptTabStop({
    focused: focusedIndex,
    playing: activeIndex,
    lastFocused: lastFocusedIndex,
    count: transcript.length,
  });

  const seekToLine = async (seconds: number) => {
    if (isActive) {
      player.seek(seconds);
      if (!player.isPlaying) player.play();
    } else if (audioUrl) {
      await player.play({
        id: conversationId,
        src: audioUrl,
        data: { contributorName },
      });
      player.seek(seconds);
    }
  };

  const seekButtonIndex = (target: EventTarget | null): number | null => {
    if (!(target instanceof HTMLElement)) return null;
    const raw = target.dataset.transcriptSeek;
    return raw === undefined ? null : Number(raw);
  };

  // Scroll active line to center of the fixed-height container
  useEffect(() => {
    if (activeIndex !== prevIndexRef.current && activeIndex >= 0) {
      prevIndexRef.current = activeIndex;
      const container = scrollRef.current;
      const lineEl = lineRefs.current.get(activeIndex);
      if (container && lineEl) {
        const containerH = container.clientHeight;
        const lineTop = lineEl.offsetTop;
        const lineH = lineEl.offsetHeight;
        const target = lineTop - containerH / 2 + lineH / 2;
        container.scrollTo({ top: target, behavior: "smooth" });
      }
    }
  }, [activeIndex]);

  const transcriptContent = (
    <div className={cn("relative overflow-hidden rounded-lg", expanded && "overflow-visible")}>
      {!expanded && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-background to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-background to-transparent" />
        </>
      )}

      <div
        ref={scrollRef}
        className={cn(
          "scroll-smooth scrollbar-none",
          expanded ? "overflow-visible" : "max-h-[240px] overflow-y-auto py-8",
        )}
        style={{ scrollbarWidth: "none" }}
      >
        <div
          role="list"
          aria-label="Transcript"
          className={cn("space-y-1", expanded ? "px-0" : "px-2")}
          onFocus={(e) => {
            const index = seekButtonIndex(e.target);
            if (index === null) return;
            setFocusedIndex(index);
            setLastFocusedIndex(index);
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setFocusedIndex(null);
            }
          }}
          onKeyDown={(e) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            const index = seekButtonIndex(e.target);
            if (index === null) return;
            const next = transcriptKeyTarget(e.key, index, transcript.length);
            if (next === null) return;
            e.preventDefault();
            seekButtonRefs.current.get(next)?.focus();
          }}
        >
          {transcript.map((msg, i) => {
            const isCurrent = i === activeIndex;
            const isPast = activeIndex >= 0 && i < activeIndex;
            const isFuture = activeIndex >= 0 && i > activeIndex;
            const lineTextId = `${lineIdPrefix}-line-${i}`;

            return (
              // The whole line seeks on click or tap; the timestamp button is
              // the keyboard and screen-reader control for the same seek.
              <div
                key={i}
                role="listitem"
                ref={(el) => {
                  if (el) lineRefs.current.set(i, el);
                  else lineRefs.current.delete(i);
                }}
                onClick={() => void seekToLine(msg.time_in_call_secs)}
                className={cn(
                  "group/msg cursor-pointer rounded-md px-3 py-2 text-sm leading-relaxed transition-all duration-300 pointer-coarse:min-h-10",
                  isCurrent && "bg-org-accent-selected text-foreground ring-1 ring-org-accent-border",
                  !isCurrent && msg.role === "ai" && "bg-muted/90",
                  !isCurrent && msg.role !== "ai" && "bg-muted/55",
                  isPast && "opacity-40",
                  isFuture && "opacity-50",
                  !isCurrent && "hover:opacity-80 hover:bg-muted/70",
                  // A faded line would fade its focus outline with it.
                  "has-[:focus-visible]:opacity-100",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div id={lineTextId} className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "font-medium transition-all duration-300",
                        isCurrent && "text-base",
                        msg.role === "ai" ? "text-org-accent" : "text-foreground",
                      )}
                    >
                      {transcriptSpeakerName(msg, contributorName)}
                    </span>
                    <span
                      className={cn(
                        "transition-all duration-300",
                        isCurrent
                          ? "font-medium text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {" \u2014 "}
                      {msg.content}
                    </span>
                  </div>
                  {/* Hidden until hover for mouse users, but always shown on
                      touch, and shown whenever it has keyboard focus. */}
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) seekButtonRefs.current.set(i, el);
                      else seekButtonRefs.current.delete(i);
                    }}
                    data-transcript-seek={i}
                    tabIndex={i === tabStop ? 0 : -1}
                    aria-label={`Play from ${formatDuration(msg.time_in_call_secs)}`}
                    aria-describedby={lineTextId}
                    aria-current={isCurrent ? "true" : undefined}
                    onClick={(e) => {
                      // The line's own click would seek a second time.
                      e.stopPropagation();
                      void seekToLine(msg.time_in_call_secs);
                    }}
                    className="focus-ring shrink-0 rounded-sm px-1 text-2xs tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover/msg:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                  >
                    {formatDuration(msg.time_in_call_secs)}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  if (expanded) {
    return transcriptContent;
  }

  return (
    <Collapsible
      open={collapsibleOpen}
      onOpenChange={(val) => {
        setOpen(val);
        setUserToggled(true);
      }}
    >
      <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ChevronRight className="size-3 transition-transform group-data-[panel-open]:rotate-90" />
        Full Transcript
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2">{transcriptContent}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// --- Keyboard Shortcuts ---

// Focused elements that use a key themselves, so the shortcut must leave it
// alone. Text fields take every key; anything clickable takes Space; list,
// tab and slider widgets take the arrows. The waveform slider also consumes
// its own keys (prevented, so the check above skips them); it's listed so an
// arrow it lets through never seeks a different conversation.
const TEXT_ENTRY_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  '[role="textbox"]',
  '[role="combobox"]',
].join(",");
const SPACE_SELECTOR = [
  TEXT_ENTRY_SELECTOR,
  "button",
  "a[href]",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="treeitem"]',
].join(",");
const ARROW_SELECTOR = [
  TEXT_ENTRY_SELECTOR,
  '[role="tablist"]',
  '[role="radiogroup"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="tree"]',
  '[role="slider"]',
].join(",");

function targetOwnsKey(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof Element)) return false;
  const selector =
    key === " "
      ? SPACE_SELECTOR
      : key === "ArrowLeft" || key === "ArrowRight"
        ? ARROW_SELECTOR
        : TEXT_ENTRY_SELECTOR;
  return target.closest(selector) !== null;
}

function KeyboardShortcuts() {
  const player = useAudioPlayer();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (targetOwnsKey(e.target, e.key)) return;
      if (!player.activeItem) return;

      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          if (player.isPlaying) player.pause();
          else player.play();
          break;
        case "ArrowLeft":
          e.preventDefault();
          player.seek(
            Math.max(0, (player.ref.current?.currentTime ?? 0) - 5)
          );
          break;
        case "ArrowRight":
          e.preventDefault();
          player.seek(
            Math.min(
              player.duration ?? 0,
              (player.ref.current?.currentTime ?? 0) + 5
            )
          );
          break;
        case "j":
          e.preventDefault();
          player.seek(
            Math.max(0, (player.ref.current?.currentTime ?? 0) - 10)
          );
          break;
        case "l":
          e.preventDefault();
          player.seek(
            Math.min(
              player.duration ?? 0,
              (player.ref.current?.currentTime ?? 0) + 10
            )
          );
          break;
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [player]);

  return null;
}

// --- Sticky Mini-Player ---

// Docks to the bottom of the screen once the panel's own controls scroll out
// of view. It watches the controls row, not the whole panel: on a phone the
// panel runs the full transcript's length, so it stays on screen long after
// the controls have gone.
function StickyMiniPlayer({
  conversationId,
  controls,
}: {
  conversationId: Id<"conversations">;
  controls: HTMLElement | null;
}) {
  const player = useAudioPlayer<{ contributorName: string }>();
  const time = useAudioPlayerTime();
  const [controlsPosition, setControlsPosition] =
    useState<ControlsPosition>("visible");

  useEffect(() => {
    if (!controls) return;

    const observer = new IntersectionObserver(([entry]) =>
      setControlsPosition(
        controlsPositionFrom(
          entry,
          entry.rootBounds?.height ?? window.innerHeight,
        ),
      ),
    );
    observer.observe(controls);
    return () => observer.disconnect();
  }, [controls]);

  if (
    !player.activeItem ||
    !shouldDockMiniPlayer({
      controls: controlsPosition,
      isPlaying: player.isPlaying,
      activeItemIsShown: player.isItemActive(conversationId),
    })
  ) {
    return null;
  }

  const name = player.activeItem.data?.contributorName ?? "Playing";
  const JumpIcon = controlsPosition === "above" ? ArrowUp : ArrowDown;

  return (
    <div
      ref={registerBottomDock}
      className="fixed inset-x-0 bottom-0 z-dock border-t bg-background/95 px-4 py-2 shadow-lg backdrop-blur-sm"
    >
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <AudioPlayerButton
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 pointer-coarse:size-10"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{name}</p>
          <AudioPlayerProgress className="mt-1" />
        </div>
        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
          {formatDuration(time)}
        </span>
        <button
          type="button"
          onClick={() => {
            if (!controls) return;
            scrollIntoNearestScroller(controls, "center");
            // The bar unmounts once the controls are back on screen, so hand
            // focus to their play button rather than dropping it on the page.
            controls
              .querySelector<HTMLElement>("[data-playback-toggle]")
              ?.focus({ preventScroll: true });
          }}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-ring pointer-coarse:size-10"
          aria-label="Show playback controls"
        >
          <JumpIcon className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

export function FocusedConversationPlayback({
  conversation,
  title,
  canLabelSpeakers,
  canRetry,
}: {
  conversation: Doc<"conversations">;
  /** The same title as the selected row, so it's clear what is playing. */
  title: string;
  canLabelSpeakers: boolean;
  /** Admins can retry a failed contribution from here. */
  canRetry: boolean;
}) {
  const isAwaitingSpeakerLabels =
    conversation.status === "needs_speaker_labels";
  const isDone = conversation.status === "done";
  const audioUrl = useConversationAudioUrl(
    conversation.clerkOrgId,
    conversation._id,
  );
  const transcript = conversation.transcript as
    | TranscriptMessage[]
    | undefined;
  const [, markListened] = useListenedState(String(conversation._id));
  const canExportPdf = Boolean(conversation.summary || transcript?.length);
  // Held in state so the mini-player's observer starts once the row mounts.
  const [controlsElement, setControlsElement] =
    useState<HTMLDivElement | null>(null);

  return (
    <AudioPlayerProvider>
      <TooltipProvider>
        <KeyboardShortcuts />
        {/* The bottom padding is room for the docked mini-player, so it never
            covers the last transcript lines. Below `md` the tab scrolls as one
            column and this panel ends it. */}
        <div className="flex h-full min-h-0 w-full flex-col bg-background pb-[var(--bottom-dock-height,0px)]">
          <div className="shrink-0 space-y-3 border-b p-4">
            <div className="space-y-2">
              <h2 className="break-words text-base font-semibold leading-snug text-foreground">
                {title}
              </h2>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <StatusBadge meta={conversationStatusMeta[conversation.status]} />
                {/* "Completed" is about processing, and is easily read as a
                    verdict on the contribution itself. */}
                {isDone && (
                  <p className="text-xs text-muted-foreground">
                    Processing finished. This doesn&apos;t mean it covers the
                    whole process.
                  </p>
                )}
              </div>
            </div>

            <div
              ref={setControlsElement}
              className="flex min-w-0 items-center gap-3"
            >
              <div className="min-w-0 flex-1">
                {isDone ? (
                  audioUrl ? (
                    <ConversationAudioControls
                      conversationId={conversation._id}
                      audioUrl={audioUrl}
                      durationSeconds={conversation.durationSeconds ?? undefined}
                      transcript={transcript}
                      contributorName={conversation.contributorName}
                      onListened={markListened}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Audio is loading or unavailable.
                    </p>
                  )
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Playback will be available when processing is complete.
                  </p>
                )}
              </div>
              {canExportPdf && (
                <Tooltip>
                  <TooltipTrigger
                    type="button"
                    onClick={() => downloadConversationPdf(conversation, transcript)}
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-ring"
                    aria-label="Export contribution PDF"
                  >
                    <Download className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent>Export PDF</TooltipContent>
                </Tooltip>
              )}
            </div>

            {conversation.status === "failed" && (
              <ConversationFailureNotice
                conversation={conversation}
                canRetry={canRetry}
              />
            )}

          </div>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
            {isAwaitingSpeakerLabels && canLabelSpeakers && (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Speaker Labels</h3>
                <SpeakerLabelReview conversation={conversation} />
              </section>
            )}

            {isAwaitingSpeakerLabels && !canLabelSpeakers && (
              <p className="text-sm text-muted-foreground">
                Waiting for a contributor to name speakers before analysis runs.
              </p>
            )}

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Summary</h3>
              {conversation.summary ? (
                <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                  {conversation.summary}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No summary is available yet.
                </p>
              )}
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Transcript</h3>
                {transcript && transcript.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {transcript.length} entries
                  </span>
                )}
              </div>
              {transcript && transcript.length > 0 ? (
                <SyncedTranscript
                  conversationId={conversation._id}
                  transcript={transcript}
                  contributorName={conversation.contributorName}
                  audioUrl={audioUrl}
                  expanded
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  No transcript is available yet.
                </p>
              )}
            </section>
          </div>
        </div>
        <StickyMiniPlayer
          conversationId={conversation._id}
          controls={controlsElement}
        />
      </TooltipProvider>
    </AudioPlayerProvider>
  );
}
