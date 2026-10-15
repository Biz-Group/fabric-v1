"use client";

import { useEffect, useRef, useState, type UIEvent } from "react";
import { FileText, PlayCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseVtt, type VttCue } from "./parse-vtt";
import { playedSeconds, tourSecondsLeft } from "./onboarding-view-model";

// Rendered from captures of the live product; tools/demo-video/README.md
// explains how to regenerate these files after UI changes.
const TOUR_VIDEO_SRC = "/demo/fabric-tour.mp4";
const TOUR_POSTER_SRC = "/demo/fabric-tour-poster.jpg";
const TOUR_CAPTIONS_SRC = "/demo/fabric-tour.en.vtt";

/** A stall this long offers the transcript instead. */
const STALL_FALLBACK_MS = 10_000;
/** Within this many pixels of the end counts as having read to the bottom. */
const SCROLL_END_SLACK_PX = 8;

export type TourWatchedVia = "video" | "transcript";

type TourPlayerProps = {
  /** "gate" waits for the member to press play; "replay" starts at once. */
  mode: "gate" | "replay";
  /** Fires once: when 90% has actually been played, or the transcript has
   * been read to the end. */
  onWatched: (via: TourWatchedVia) => void;
  /** Seconds still to play before it counts, or null until the duration is
   * known. Drives the gate button's "n:nn left". */
  onSecondsLeftChange?: (seconds: number | null) => void;
  className?: string;
};

type Transcript =
  | { status: "closed" }
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; cues: VttCue[] };

function formatCueTime(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function TourPlayer({
  mode,
  onWatched,
  onSecondsLeftChange,
  className,
}: TourPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const watchedRef = useRef(false);
  const stallTimerRef = useRef<number | null>(null);
  const [transcript, setTranscript] = useState<Transcript>({ status: "closed" });

  useEffect(
    () => () => {
      if (stallTimerRef.current !== null) {
        window.clearTimeout(stallTimerRef.current);
      }
    },
    [],
  );

  const markWatched = (via: TourWatchedVia) => {
    if (watchedRef.current) return;
    watchedRef.current = true;
    onWatched(via);
  };

  const trackProgress = () => {
    const video = videoRef.current;
    if (!video) return;
    const left = tourSecondsLeft(playedSeconds(video.played), video.duration);
    onSecondsLeftChange?.(left);
    if (left === 0) markWatched("video");
  };

  const clearStallTimer = () => {
    if (stallTimerRef.current === null) return;
    window.clearTimeout(stallTimerRef.current);
    stallTimerRef.current = null;
  };

  const openTranscript = async () => {
    clearStallTimer();
    videoRef.current?.pause();
    setTranscript({ status: "loading" });
    try {
      const response = await fetch(TOUR_CAPTIONS_SRC);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setTranscript({ status: "ready", cues: parseVtt(await response.text()) });
    } catch {
      setTranscript({ status: "failed" });
    }
  };

  const startStallTimer = () => {
    if (stallTimerRef.current !== null) return;
    stallTimerRef.current = window.setTimeout(() => {
      stallTimerRef.current = null;
      void openTranscript();
    }, STALL_FALLBACK_MS);
  };

  const handleTranscriptScroll = (event: UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = event.currentTarget;
    if (scrollTop + clientHeight >= scrollHeight - SCROLL_END_SLACK_PX) {
      markWatched("transcript");
    }
  };

  const transcriptOpen = transcript.status !== "closed";

  return (
    <div className={cn("min-w-0", className)}>
      <video
        ref={videoRef}
        className={cn(
          "aspect-video w-full rounded-lg bg-muted",
          transcriptOpen && "hidden",
        )}
        src={TOUR_VIDEO_SRC}
        poster={TOUR_POSTER_SRC}
        controls
        autoPlay={mode === "replay"}
        playsInline
        preload="metadata"
        aria-label="Fabric product tour"
        onLoadedMetadata={trackProgress}
        onTimeUpdate={trackProgress}
        onError={() => void openTranscript()}
        onStalled={startStallTimer}
        onProgress={clearStallTimer}
        onPlaying={clearStallTimer}
      >
        <track
          src={TOUR_CAPTIONS_SRC}
          kind="captions"
          srcLang="en"
          label="English"
          default
        />
      </video>

      {transcriptOpen && (
        <div className="rounded-lg border bg-card">
          <div
            className="max-h-[min(24rem,55dvh)] overflow-y-auto px-4 py-3"
            onScroll={handleTranscriptScroll}
            tabIndex={0}
            aria-label="Tour transcript"
          >
            {transcript.status === "loading" && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Loading the transcript…
              </p>
            )}
            {transcript.status === "failed" && (
              <p role="alert" className="py-6 text-center text-sm text-destructive">
                The transcript couldn&apos;t be loaded. Check your connection
                and try again.
              </p>
            )}
            {transcript.status === "ready" && (
              <ol className="space-y-2.5">
                {transcript.cues.map((cue) => (
                  <li
                    key={`${cue.start}-${cue.end}`}
                    className="flex gap-3 text-sm leading-6"
                  >
                    <span className="w-9 shrink-0 pt-px font-mono text-xs leading-6 text-muted-foreground tabular-nums">
                      {formatCueTime(cue.start)}
                    </span>
                    <span>{cue.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          {transcript.status === "ready" && (
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              Scroll to the end to finish the tour.
            </p>
          )}
        </div>
      )}

      <div className="mt-2 flex justify-end">
        {transcriptOpen ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setTranscript({ status: "closed" })}
          >
            <PlayCircle className="size-3.5" aria-hidden="true" />
            Back to the video
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => void openTranscript()}
          >
            <FileText className="size-3.5" aria-hidden="true" />
            Can&apos;t play video here? Read it instead
          </button>
        )}
      </div>
    </div>
  );
}
