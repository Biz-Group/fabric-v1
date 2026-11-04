import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import styles from "./ask-thinking-mark.module.css";

/**
 * The Fabric logo's seven parts in reading order: three top tiles, the tilted
 * bar, two bottom tiles, the dot. `waveAt` is each part's place along the
 * top-left to bottom-right diagonal, as a share of the loop.
 */
const PARTS: { waveAt: number; shape: ReactNode }[] = [
  {
    waveAt: 0,
    shape: (
      <path d="M 144.00 129.00 L 326.00 129.00 Q 344.00 129.00 344.00 147.00 L 344.00 392.87 Q 344.00 409.00 327.97 410.76 L 145.97 430.80 Q 126.00 433.00 126.00 412.91 L 126.00 147.00 Q 126.00 129.00 144.00 129.00 Z" />
    ),
  },
  {
    waveAt: 0.12,
    shape: (
      <path d="M 414.00 129.00 L 592.00 129.00 Q 610.00 129.00 610.00 147.00 L 610.00 359.60 Q 610.00 376.00 593.67 377.53 L 415.67 394.16 Q 396.00 396.00 396.00 376.24 L 396.00 147.00 Q 396.00 129.00 414.00 129.00 Z" />
    ),
  },
  {
    waveAt: 0.25,
    shape: (
      <path d="M 679.00 128.00 L 879.00 128.00 Q 897.00 128.00 897.00 146.00 L 897.00 324.32 Q 897.00 341.00 880.37 342.27 L 680.37 357.52 Q 661.00 359.00 661.00 339.57 L 661.00 146.00 Q 661.00 128.00 679.00 128.00 Z" />
    ),
  },
  {
    waveAt: 0.23,
    shape: (
      <rect x="127.3" y="431.7" width="702" height="164" rx="18" ry="18" transform="rotate(-8.3 478.3 513.7)" />
    ),
  },
  {
    waveAt: 0.25,
    shape: (
      <path d="M 142.36 681.50 L 324.36 664.80 Q 344.00 663.00 344.00 682.73 L 344.00 887.00 Q 344.00 905.00 326.00 905.00 L 144.00 905.00 Q 126.00 905.00 126.00 887.00 L 126.00 699.42 Q 126.00 683.00 142.36 681.50 Z" />
    ),
  },
  {
    waveAt: 0.37,
    shape: (
      <path d="M 412.49 642.61 L 590.49 627.64 Q 610.00 626.00 610.00 645.58 L 610.00 887.00 Q 610.00 905.00 592.00 905.00 L 414.00 905.00 Q 396.00 905.00 396.00 887.00 L 396.00 660.55 Q 396.00 644.00 412.49 642.61 Z" />
    ),
  },
  { waveAt: 0.5, shape: <circle cx="753" cy="789.5" r="96" /> },
];

/**
 * The Fabric mark in an answer's byline. While the answer is worked on a
 * brightness ripple runs through it (1H.17); `still` settles it once the
 * answer is done. Decorative: the words beside it carry the status. Under
 * reduced motion it stands still.
 */
export function AskThinkingMark({ className, still = false }: { className?: string; still?: boolean }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      width={16}
      height={16}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", !still && styles.mark, className)}
    >
      {PARTS.map(({ waveAt, shape }, index) => (
        <g key={index} className={still ? undefined : styles.part} style={{ "--wave-at": waveAt } as CSSProperties}>
          {shape}
        </g>
      ))}
    </svg>
  );
}
