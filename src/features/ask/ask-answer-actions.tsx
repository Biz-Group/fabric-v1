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

type MediaSourceType = typeof MediaSource;

/** MSE that takes MP3, or null. Safari on iPhone offers `ManagedMediaSource`. */
function streamingSource(): MediaSourceType | null {
  const scope = window as unknown as { MediaSource?: MediaSourceType; ManagedMediaSource?: MediaSourceType };
  const Source = scope.MediaSource ?? scope.ManagedMediaSource;
  return Source && Source.isTypeSupported("audio/mpeg") ? Source : null;
}

function append(buffer: SourceBuffer, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    buffer.addEventListener("updateend", () => resolve(), { once: true });
    buffer.addEventListener("error", () => reject(new Error("Couldn't buffer the audio.")), { once: true });
    buffer.appendBuffer(chunk as BufferSource);
  });
}

/**
 * Feeds the stream into the audio element as it arrives and calls `onReady`
 * at the first chunk. Without MP3 streaming support, waits for the whole file.
 * Returns the object URL to revoke later.
 */
async function streamInto(audio: HTMLAudioElement, url: string, onReady: () => void): Promise<string> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error("Couldn't read this answer aloud.");
  const Source = streamingSource();
  if (!Source) {
    const objectUrl = URL.createObjectURL(await response.blob());
    audio.src = objectUrl;
    onReady();
    return objectUrl;
  }
  const source = new Source();
  audio.disableRemotePlayback = true;
  const objectUrl = URL.createObjectURL(source);
  audio.src = objectUrl;
  await new Promise((resolve) => source.addEventListener("sourceopen", resolve, { once: true }));
  const buffer = source.addSourceBuffer("audio/mpeg");
  const reader = response.body.getReader();
  let ready = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    await append(buffer, value);
    if (!ready) {
      ready = true;
      onReady();
    }
  }
  if (source.readyState === "open") source.endOfStream();
  return objectUrl;
}

/**
 * Read aloud: the button spins until the first audio arrives, then toggles
 * pause and play. The first press streams the audio as ElevenLabs generates
 * it; later presses replay the stored file. When it ends, the button goes
 * back to the speaker.
 */
export function ReadAloudButton({ messageId }: { messageId: Id<"askMessages"> }) {
  const readAloud = useAction(api.askSpeech.readAloud);
  const [playback, setPlayback] = useState<Playback>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (speaking === audioRef.current) speaking = null;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
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

  const newAudio = () => {
    const audio = new Audio();
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
    const next = newAudio();
    try {
      const source = await readAloud({ messageId });
      audioRef.current = next;
      if (source.kind === "stored") {
        next.src = source.url;
        await play(next);
      } else {
        objectUrlRef.current = await streamInto(next, source.url, () => void play(next));
      }
    } catch (error) {
      next.pause();
      audioRef.current = null;
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
