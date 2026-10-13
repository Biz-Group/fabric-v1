"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

// Set to "true" once passkeys are switched on for the Clerk instance
// (Dashboard → User & authentication → Passkeys). Clerk has no client-side
// flag for it, and offering a passkey the instance rejects is worse than not
// offering one.
const PASSKEYS_ENABLED =
  process.env.NEXT_PUBLIC_CLERK_PASSKEYS_ENABLED === "true";

// sessionStorage: set when a sign-in completes, consumed by the next
// workspace load, so the offer appears once, right after an email code.
const OFFER_KEY = "fabric:offer-passkey";
// localStorage, per user: "Not now" holds further offers off on this device.
const SNOOZE_KEY_PREFIX = "fabric:passkey-offer-snoozed:";
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;
// Let the workspace render before the offer slides in.
const OFFER_DELAY_MS = 1_500;

/** Marks this tab so the workspace offers a passkey after this sign-in. */
export function offerPasskeyAfterSignIn(): void {
  try {
    window.sessionStorage.setItem(OFFER_KEY, "1");
  } catch {
    // Storage blocked: no offer this time.
  }
}

function takeOffer(): boolean {
  try {
    const offered = window.sessionStorage.getItem(OFFER_KEY) === "1";
    window.sessionStorage.removeItem(OFFER_KEY);
    return offered;
  } catch {
    return false;
  }
}

function isSnoozed(userId: string): boolean {
  try {
    const snoozedAt = Number(
      window.localStorage.getItem(SNOOZE_KEY_PREFIX + userId),
    );
    return Number.isFinite(snoozedAt) && Date.now() - snoozedAt < SNOOZE_MS;
  } catch {
    return false;
  }
}

function snooze(userId: string): void {
  try {
    window.localStorage.setItem(SNOOZE_KEY_PREFIX + userId, String(Date.now()));
  } catch {
    // Storage blocked: the offer may come back after the next sign-in.
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { code } = error as { code?: unknown };
  return typeof code === "string" ? code : undefined;
}

type OfferUser = NonNullable<ReturnType<typeof useUser>["user"]>;

function showOffer(user: OfferUser): void {
  const addPasskey = async () => {
    try {
      await user.createPasskey();
      toast.success("Passkey added", {
        description: "Next time, choose “Sign in with passkey”.",
      });
    } catch (error) {
      const code = errorCode(error);
      if (
        code === "passkey_registration_cancelled" ||
        code === "passkey_operation_aborted"
      ) {
        return;
      }
      if (code === "passkey_already_exists") {
        toast.success("This device already has a Fabric passkey.");
        return;
      }
      toast.error("We couldn't add a passkey", {
        description:
          "You can add one later from your profile: Manage account → Security.",
      });
    }
  };

  toast("Sign in faster next time", {
    description:
      "Add a passkey to sign in with your fingerprint, face or device PIN instead of an email code.",
    duration: Infinity,
    action: { label: "Add passkey", onClick: () => void addPasskey() },
    cancel: { label: "Not now", onClick: () => snooze(user.id) },
    onDismiss: () => snooze(user.id),
  });
}

/**
 * Offers a passkey once after sign-in to members who have none, so the next
 * sign-in is a fingerprint or device PIN instead of an email code. Passkeys
 * are bound to the root domain, so one works on every workspace.
 */
export function PasskeyOffer() {
  const { user } = useUser();
  // Clerk hands out a new user object on every session refresh; keying the
  // effect on it would keep resetting the delay.
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);
  const userId = user?.id;

  useEffect(() => {
    if (!PASSKEYS_ENABLED || !userId) return;
    const timer = window.setTimeout(() => {
      const current = userRef.current;
      // Consumed only now, so an offer interrupted before it shows survives
      // to the next workspace load.
      if (!current || !takeOffer()) return;
      if (current.passkeys.length > 0) return;
      if (typeof window.PublicKeyCredential !== "function") return;
      if (isSnoozed(current.id)) return;
      showOffer(current);
    }, OFFER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [userId]);

  return null;
}
