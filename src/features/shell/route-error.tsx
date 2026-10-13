"use client";

import { useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { type ReactNode, useEffect } from "react";
import {
  type AuthErrorCode,
  authErrorCode,
} from "../../../convex/lib/authErrors";

type Copy = { title: string; body: string };

const COPY: Record<AuthErrorCode | "UNKNOWN", Copy> = {
  NOT_AUTHENTICATED: {
    title: "Your session has ended",
    body: "Sign in again to pick up where you left off.",
  },
  NO_ACTIVE_ORG: {
    title: "We lost track of your workspace",
    body: "This can happen when you switch workspaces in another tab. Try again to reconnect.",
  },
  NOT_MEMBER: {
    title: "You don't have access to this workspace",
    body: "Your account isn't a member of this workspace. If you think that's a mistake, ask a workspace admin to invite you.",
  },
  REMOVED: {
    title: "Your access to this workspace was removed",
    body: "A workspace admin removed you. If you still need access, ask them to invite you again.",
  },
  INSUFFICIENT_ROLE: {
    title: "You don't have permission to view this",
    body: "Your role in this workspace doesn't include this page. Ask a workspace admin if you need access.",
  },
  UNKNOWN: {
    title: "Something went wrong",
    body: "This page hit an unexpected error. Try again, or reload the page.",
  },
};

const primaryButton =
  "h-10 rounded-xl bg-foreground px-4 text-sm font-medium text-background hover:bg-foreground/90";
const secondaryButton =
  "h-10 rounded-xl border border-border bg-background px-4 text-sm font-medium hover:bg-muted";

/**
 * Fallback for an error thrown while rendering a route. Auth failures from
 * Convex carry a code, so each gets a screen that explains it and offers the
 * way out that fits, instead of a generic crash page.
 */
export function RouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const { redirectToSignIn, signOut } = useClerk();
  const code = authErrorCode(error);
  const { title, body } = COPY[code ?? "UNKNOWN"];

  useEffect(() => {
    if (!code) console.error(error);
  }, [code, error]);

  let actions: ReactNode;
  switch (code) {
    case "NOT_AUTHENTICATED":
      actions = (
        <button
          type="button"
          className={primaryButton}
          onClick={() =>
            void redirectToSignIn({ redirectUrl: window.location.href })
          }
        >
          Sign in again
        </button>
      );
      break;
    case "NOT_MEMBER":
    case "REMOVED":
      actions = (
        <>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => void signOut({ redirectUrl: "/sign-in" })}
          >
            Sign out
          </button>
        </>
      );
      break;
    case "INSUFFICIENT_ROLE":
      actions = (
        <>
          <Link href="/" className={`${primaryButton} inline-flex items-center`}>
            Go to workspace home
          </Link>
          <button type="button" className={secondaryButton} onClick={retry}>
            Try again
          </button>
        </>
      );
      break;
    default:
      actions = (
        <>
          <button type="button" className={primaryButton} onClick={retry}>
            Try again
          </button>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </>
      );
  }

  return (
    <div
      role="alert"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {actions}
      </div>
    </div>
  );
}
