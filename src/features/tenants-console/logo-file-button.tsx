"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";

const LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";

/** Styled replacement for a bare `<input type="file">`, whose native
 * "Choose File" chrome can't be themed. Renders a proper Button and proxies
 * clicks to a visually hidden input. */
export function LogoFileButton({
  label,
  disabled,
  onSelect,
}: {
  label: string;
  disabled?: boolean;
  onSelect: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={LOGO_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset so picking the same file again still fires onChange.
          e.target.value = "";
          if (file) onSelect(file);
        }}
      />
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        {label}
      </Button>
    </>
  );
}
