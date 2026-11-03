"use client";

import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Loader2, Pause, Play, Volume2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/user-error-message";
import { copyableAnswer } from "./trace-view-model";

const COPIED_MS = 2_000;

/** Copies the answer with its sources listed under it. */
export function CopyAnswerButton({
  text,
  citations,
}: {
  text: string;
  citations: { ordinal: number; title: string }[];
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={copied ? "Copied" : "Copy answer"}
      className="text-muted-foreground"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(copyableAnswer(text, citations));
          setCopied(true);
        } catch {
          toast.error("Couldn't copy the answer.");
        }
      }}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </Button>
  );
}

type Playback = "idle" | "loading" | "playing" | "paused";

/** Only one answer speaks at a time: starting one pauses the other. */
let speaking: HTMLAudioElement | null = null;

/**
 * Read aloud: the first press fetches the answer's audio (generated once, then
 * stored), the button spins until it arrives, then toggles pause and play.
 * When the audio ends, the button goes back to the speaker.
 */
export function ReadAloudButton({ messageId }: { messageId: Id<"askMessages"> }) {
  const readAloud = useAction(api.askSpeech.readAloud);
  const [playback, setPlayback] = useState<Playback>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (speaking === audioRef.current) speaking = null;
    },
    [],
  );

  const play = async (audio: HTMLAudioElement) => {
    if (speaking && speaking !== audio) speaking.pause();
    speaking = audio;
    try {
      await audio.play();
    } catch {
      // A browser that blocks playback without a fresh tap (Safari, after the
      // wait): leave it ready, so the next tap plays.
      setPlayback("paused");
    }
  };

  const audioFor = (url: string) => {
    const audio = new Audio(url);
    audio.addEventListener("play", () => setPlayback("playing"));
    audio.addEventListener("pause", () => setPlayback(audio.ended ? "idle" : "paused"));
    audio.addEventListener("ended", () => {
      audio.currentTime = 0;
      setPlayback("idle");
    });
    audio.addEventListener("error", () => {
      audioRef.current = null;
      setPlayback("idle");
      toast.error("Couldn't play this answer.");
    });
    return audio;
  };

  const onClick = async () => {
    const audio = audioRef.current;
    if (playback === "playing" && audio) {
      audio.pause();
      return;
    }
    if (audio) {
      await play(audio);
      return;
    }
    setPlayback("loading");
    try {
      const { url } = await readAloud({ messageId });
      const next = audioFor(url);
      audioRef.current = next;
      await play(next);
    } catch (error) {
      setPlayback("idle");
      toast.error(describeError(error, "Couldn't read this answer aloud."));
    }
  };

  const label =
    playback === "loading"
      ? "Preparing audio"
      : playback === "playing"
        ? "Pause"
        : playback === "paused"
          ? "Resume reading aloud"
          : "Read aloud";
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      aria-busy={playback === "loading"}
      disabled={playback === "loading"}
      className={playback === "playing" || playback === "paused" ? "text-foreground" : "text-muted-foreground"}
      onClick={() => void onClick()}
    >
      {playback === "loading" ? (
        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
      ) : playback === "playing" ? (
        <Pause className="size-3.5" aria-hidden />
      ) : playback === "paused" ? (
        <Play className="size-3.5" aria-hidden />
      ) : (
        <Volume2 className="size-3.5" aria-hidden />
      )}
    </Button>
  );
}
