"use client";

import { useId, useRef, useState, type Ref } from "react";
import { Popover } from "@base-ui/react/popover";

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
  inputRef,
}: {
  inputRef?: Ref<HTMLInputElement>;
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
          ref={inputRef}
          id={inputId}
          value={workspace}
          onChange={(event) => {
            setWorkspace(event.target.value);
            setError(null);
          }}
          placeholder="your-workspace"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        <span aria-hidden="true">.{ROOT_HOSTNAME}</span>
      </div>
      {/* An alert is announced as it appears, without moving focus off the input. */}
      {error && (
        <p id={errorId} role="alert" className={styles.signInError}>
          {error}
        </p>
      )}
      <button type="submit" className={styles.signInSubmit}>
        Continue
      </button>
    </form>
  );
}

/**
 * "Sign in" in the desktop navigation, opening the workspace form. The popover
 * closes on Escape or an outside press and hands focus back to the trigger. It
 * portals into its own wrapper so the page's CSS variables and fonts still apply.
 */
export function SignInMenu() {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!ROOT_DOMAIN) return null;

  return (
    <div ref={rootRef} className={styles.signInMenu}>
      <Popover.Root>
        <Popover.Trigger>Sign in</Popover.Trigger>
        <Popover.Portal container={rootRef}>
          {/* 0.8rem below the trigger, right-aligned, as the panel always sat. */}
          <Popover.Positioner
            side="bottom"
            align="end"
            sideOffset={12.8}
            collisionAvoidance={{ side: "none" }}
          >
            <Popover.Popup
              className={styles.signInPanel}
              aria-label="Sign in"
              initialFocus={inputRef}
            >
              <WorkspaceSignInForm inputRef={inputRef} />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
