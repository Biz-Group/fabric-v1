"use client";

import { useAuth, useClerk, useUser } from "@clerk/nextjs";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getTenantSubdomain } from "@/lib/subdomain";
import { offerPasskeyAfterSignIn } from "./passkey-offer";
import { clearReturnPath, readReturnPath, signInUrlFor } from "./return-path";

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "";

type JoinResponse = {
  organizationId: string;
};

type ErrorResponse = {
  error?: string;
};

/** A refusal from the join API. 403 and 404 are decisions about this account
 * (domain not allowed, removed by an admin, no such workspace) that retrying
 * won't change, so the way out is another account. */
class JoinRefusedError extends Error {
  readonly permanent: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.permanent = status === 403 || status === 404;
  }
}

type JoinError = { message: string; permanent: boolean };

async function getErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as ErrorResponse;
    if (data.error) return data.error;
  } catch {
    // Fall through to the generic message.
  }
  return "We could not join this workspace. Please try again.";
}

const FABRIC_PROFILE_SYNC_ERROR =
  "We joined you to the workspace, but could not finish setting up your Fabric profile. Please try again.";

const FABRIC_UNREACHABLE_ERROR =
  "We joined you to the workspace, but couldn't reach Fabric to finish setting up. This is usually temporary — please try again in a moment.";

// How long to wait for Convex to confirm the newly activated org before
// telling the user something is wrong instead of spinning indefinitely.
const CONVEX_ORG_READY_TIMEOUT_MS = 20_000;

export function JoinSubdomainOrganization() {
  const router = useRouter();
  const { setActive, signOut } = useClerk();
  const { isLoaded, orgId, userId } = useAuth({
    treatPendingAsSignedOut: false,
  });
  const { isLoaded: userLoaded, user } = useUser();
  const syncFabricProfile = useAction(api.users.syncCurrentUserFromClerk);
  const storeUser = useMutation(api.users.store);
  const { isAuthenticated: convexAuthenticated } = useConvexAuth();
  const convexActiveOrg = useQuery(api.users.getActiveOrg);
  const hasStarted = useRef(false);
  const hasSynced = useRef(false);
  const [error, setError] = useState<JoinError | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [targetOrganizationId, setTargetOrganizationId] = useState<
    string | null
  >(null);

  // Leaves for the page the user originally asked for, or the workspace home.
  const finish = useCallback(() => {
    const destination = readReturnPath();
    clearReturnPath();
    offerPasskeyAfterSignIn();
    router.replace(destination);
    router.refresh();
  }, [router]);

  useEffect(() => {
    if (!isLoaded || !userLoaded || hasStarted.current) return;

    if (!userId) {
      router.replace(signInUrlFor(readReturnPath()));
      return;
    }

    hasStarted.current = true;

    // Most sign-ins are by people who already belong to this workspace.
    // Activating it is all they need: the workspace provisions their Fabric
    // profile from the session on arrival. So skip the join API's Clerk
    // lookups and the profile sync. A stale or incomplete membership list only
    // costs the full path below, which handles existing members too.
    const slug = getTenantSubdomain(window.location.host, ROOT_DOMAIN);
    const existingOrgId = user?.organizationMemberships.find(
      (membership) => membership.organization.slug === slug,
    )?.organization.id;

    async function joinOrganization() {
      if (existingOrgId) {
        // A pending session must be activated before leaving: the proxy
        // treats it as signed out and would bounce straight back here.
        if (orgId !== existingOrgId) {
          await setActive({ organization: existingOrgId });
        }
        finish();
        return;
      }

      const response = await fetch("/api/join-subdomain-organization", {
        method: "POST",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new JoinRefusedError(
          await getErrorMessage(response),
          response.status,
        );
      }

      const data = (await response.json()) as JoinResponse;
      setTargetOrganizationId(data.organizationId);
      await setActive({ organization: data.organizationId });
    }

    void joinOrganization().catch((joinError: unknown) => {
      setError({
        message:
          joinError instanceof Error
            ? joinError.message
            : "We could not join this workspace. Please try again.",
        permanent:
          joinError instanceof JoinRefusedError && joinError.permanent,
      });
    });
  }, [
    isLoaded,
    userLoaded,
    user,
    orgId,
    finish,
    router,
    setActive,
    userId,
    retryKey,
  ]);

  // Clerk switches `orgId` before Convex has a token carrying that org, so
  // wait until Convex itself reports the target org. Calling Convex earlier
  // races the token refresh and fails with "Not authenticated".
  const convexOrgReady =
    convexAuthenticated && convexActiveOrg?.orgId === targetOrganizationId;

  useEffect(() => {
    if (!targetOrganizationId || hasSynced.current || convexOrgReady) return;
    const timer = window.setTimeout(() => {
      if (hasSynced.current) return;
      setError({ message: FABRIC_UNREACHABLE_ERROR, permanent: false });
    }, CONVEX_ORG_READY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [targetOrganizationId, convexOrgReady]);

  useEffect(() => {
    if (
      !isLoaded ||
      !targetOrganizationId ||
      orgId !== targetOrganizationId ||
      !convexOrgReady ||
      hasSynced.current
    ) {
      return;
    }

    hasSynced.current = true;

    async function syncProfile() {
      try {
        await syncFabricProfile();
      } catch (syncError) {
        console.error(
          "Failed to sync Fabric profile from Clerk; falling back to JWT profile",
          syncError,
        );
        await storeUser();
      }

      finish();
    }

    void syncProfile().catch((syncError: unknown) => {
      console.error("Failed to finish Fabric profile setup", syncError);
      setError({
        message:
          syncError instanceof Error
            ? FABRIC_PROFILE_SYNC_ERROR
            : "We could not join this workspace. Please try again.",
        permanent: false,
      });
    });
  }, [
    isLoaded,
    orgId,
    convexOrgReady,
    finish,
    storeUser,
    syncFabricProfile,
    targetOrganizationId,
  ]);

  if (error) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm leading-6 text-destructive">{error.message}</p>
        {error.permanent ? (
          <Button
            size="lg"
            onClick={() =>
              void signOut({ redirectUrl: signInUrlFor(readReturnPath()) })
            }
            className="h-11 px-4"
          >
            Sign out and use another account
          </Button>
        ) : (
          <Button
            size="lg"
            onClick={() => {
              hasStarted.current = false;
              hasSynced.current = false;
              setError(null);
              setTargetOrganizationId(null);
              setRetryKey((key) => key + 1);
            }}
            className="h-11 px-4"
          >
            Try again
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-3 py-6"
    >
      <Spinner size="lg" className="text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        Preparing your workspace…
      </p>
    </div>
  );
}
