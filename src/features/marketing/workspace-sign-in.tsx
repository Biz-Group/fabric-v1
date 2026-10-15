"use client";

import { useEffect, useId, useRef, useState } from "react";

import { isValidTenantSlug } from "../../../convex/lib/slugs";
import styles from "@/features/marketing/marketing-landing-page.module.css";

// "bizfabric.ai" in production, "lvh.me:3000" in local dev. Unset means a
// single-host dev setup with no workspace subdomains to send anyone to.
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "";
const ROOT_HOSTNAME = ROOT_DOMAIN.split(":", 1)[0]!.toLowerCase();

/** The workspace slug in what someone typed: "acme", "Acme" or a pasted
 * "https://acme.bizfabric.ai/...". */
function workspaceSlugFrom(input: string): string {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split(/[/:?#]/, 1)[0]!;
  const suffix = `.${ROOT_HOSTNAME}`;
  return host.endsWith(suffix) ? host.slice(0, -suffix.length) : host;
}

/**
 * Sign-in happens on each workspace's own subdomain (the apex redirects
 * `/sign-in` back here), so ask which workspace and send them there.
 */
export function WorkspaceSignInForm({
  autoFocus = false,
}: {
  autoFocus?: boolean;
}) {
  const id = useId();
  const [workspace, setWorkspace] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!ROOT_DOMAIN) return null;

  const inputId = `${id}-workspace`;
  const errorId = `${id}-error`;

  return (
    <form
      className={styles.signInForm}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const slug = workspaceSlugFrom(workspace);
        if (!isValidTenantSlug(slug)) {
          setError("Enter your workspace name, the first part of your Fabric address.");
          return;
        }
        window.location.assign(
          `${window.location.protocol}//${slug}.${ROOT_DOMAIN}/sign-in`,
        );
      }}
    >
      <label htmlFor={inputId}>Sign in to your workspace</label>
      <div className={styles.signInField}>
        <input
          id={inputId}
          value={workspace}
          onChange={(event) => {
            setWorkspace(event.target.value);
            setError(null);
          }}
          placeholder="your-workspace"
          autoFocus={autoFocus}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        <span aria-hidden="true">.{ROOT_HOSTNAME}</span>
      </div>
      {error && (
        <p id={errorId} className={styles.signInError}>
          {error}
        </p>
      )}
      <button type="submit" className={styles.signInSubmit}>
        Continue
      </button>
    </form>
  );
}

/** "Sign in" in the desktop navigation, opening the workspace form. */
export function SignInMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePress);
    };
  }, [open]);

  if (!ROOT_DOMAIN) return null;

  return (
    <div ref={rootRef} className={styles.signInMenu}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        Sign in
      </button>
      {open && (
        <div id={panelId} className={styles.signInPanel}>
          <WorkspaceSignInForm autoFocus />
        </div>
      )}
    </div>
  );
}
