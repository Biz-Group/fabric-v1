"use client";

import {
  useAuth,
  useClerk,
  useOrganization,
  useOrganizationList,
  useUser,
} from "@clerk/nextjs";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { PasskeyOffer } from "@/features/auth/passkey-offer";
import { OrgThemeProvider } from "@/features/theming/org-theme-provider";
import { ThemeToaster } from "@/features/theming/theme-toaster";
import { Button, buttonVariants } from "@/components/ui/button";
import { LoadingScreen } from "@/components/ui/loading-screen";
import { PageTitle } from "@/components/ui/page-title";
import { SectionLabel } from "@/components/ui/section-label";

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "";

// The main action on an access screen sits alone, so it's a step up from `lg`.
const ACCESS_ACTION = "h-11 px-5";

// After this long on a loading screen, offer a way out instead of spinning on.
const STALLED_AFTER_MS = 20_000;

function buildSubdomainUrl(slug: string): string {
  if (typeof window === "undefined") return "";
  const { protocol, port } = window.location;
  const rootHostname = ROOT_DOMAIN.split(":")[0];
  const host = port ? `${rootHostname}:${port}` : rootHostname;
  return `${protocol}//${slug}.${host}/`;
}

type WorkspaceLink = { id: string; name: string; slug: string };

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ org: string }>();
  const slugFromUrl = params.org;
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const { isLoaded: userLoaded, isSignedIn } = useUser();
  // `useUser` counts a pending session (org not chosen yet) as signed in;
  // Convex only authenticates an active one.
  const { isSignedIn: hasActiveSession } = useAuth();
  const { redirectToSignIn } = useClerk();
  const { organization, isLoaded: orgLoaded } = useOrganization();
  const { setActive, isLoaded: orgListLoaded, userMemberships } =
    useOrganizationList({
      userMemberships: { infinite: true, pageSize: 100 },
    });
  const {
    hasNextPage: hasMoreMemberships,
    isFetching: fetchingMemberships,
    fetchNext: fetchNextMemberships,
    revalidate: revalidateMemberships,
  } = userMemberships;
  const activeOrg = useQuery(api.users.getActiveOrg);
  const matchingMembership = userMemberships.data?.find(
    (m) => m.organization.slug === slugFromUrl,
  );
  const targetOrgId = matchingMembership?.organization.id;
  // The org this tab last had open. Set once the workspace mounts.
  const [settledOrgId, setSettledOrgId] = useState<string | null>(null);
  // The Clerk session, and with it the Convex token's org claim, is shared by
  // every tab. Another tab opening a different workspace moves it there. A
  // tab that was already settled here waits for the user to choose rather
  // than taking it back, which would just move the other tab, and so on.
  const switchedElsewhere =
    !!targetOrgId &&
    settledOrgId === targetOrgId &&
    !!organization &&
    organization.id !== targetOrgId;

  // Clerk paginates userMemberships (default page size). Platform staff are
  // fanned out to every tenant, so a user can have more memberships than one
  // page holds — drain all pages before concluding non-membership, otherwise a
  // real member of a later page hits the "not in this workspace" screen.
  useEffect(() => {
    if (hasMoreMemberships && !fetchingMemberships) {
      fetchNextMemberships();
    }
  }, [hasMoreMemberships, fetchingMemberships, fetchNextMemberships]);

  // Clerk's organization sync patterns only match pathnames. Since this app
  // encodes the org in the subdomain and rewrites `/` to `/<slug>` later in
  // proxy, we still need a client-side `setActive` fallback for initial hits.
  useEffect(() => {
    if (!orgListLoaded || !orgLoaded || !userLoaded || !setActive) return;
    if (!isSignedIn || !slugFromUrl) return;
    if (!targetOrgId || switchedElsewhere) return;

    const clerkOrgReady = organization?.id === targetOrgId;
    const convexOrgReady = activeOrg?.orgId === targetOrgId;
    if (clerkOrgReady && convexOrgReady) return;

    void setActive({ organization: targetOrgId }).catch((error: unknown) => {
      // Usually the membership was just removed and the cached list still
      // has it. Refetching drops it, which moves on to the access screen
      // instead of "Loading workspace…" forever.
      console.warn("Could not activate this workspace", error);
      void revalidateMemberships?.();
    });
  }, [
    orgListLoaded,
    orgLoaded,
    userLoaded,
    isSignedIn,
    slugFromUrl,
    targetOrgId,
    organization?.id,
    activeOrg?.orgId,
    setActive,
    revalidateMemberships,
    switchedElsewhere,
  ]);

  // The proxy's auth.protect() redirects signed-out requests, but a session
  // can also end while the page is open (expiry, sign-out in another tab).
  useEffect(() => {
    if (userLoaded && !isSignedIn) {
      void redirectToSignIn({ redirectUrl: window.location.href });
    }
  }, [userLoaded, isSignedIn, redirectToSignIn]);

  if (authLoading || !userLoaded || !orgLoaded || !orgListLoaded) {
    return <StallableLoading message="Loading workspace…" />;
  }

  if (!isSignedIn) {
    return <LoadingScreen message="Redirecting to sign in…" />;
  }

  // Signed in to Clerk but Convex has no session. Either the Clerk session is
  // still pending (the setActive effect above is activating this org), or a
  // background token refresh failed while offline, which ConvexClientProvider
  // retries on its own.
  if (!isAuthenticated) {
    return (
      <StallableLoading
        message={
          hasActiveSession
            ? "Reconnecting to your workspace…"
            : "Loading workspace…"
        }
      />
    );
  }

  // Don't conclude non-membership until every membership page has loaded —
  // the target org may still be on a not-yet-fetched page.
  if (
    !matchingMembership &&
    (userMemberships.hasNextPage || userMemberships.isFetching)
  ) {
    return <StallableLoading message="Loading workspace…" />;
  }

  if (!matchingMembership) {
    const otherWorkspaces = (userMemberships.data ?? []).flatMap((m) =>
      m.organization.slug
        ? [
            {
              id: m.organization.id,
              name: m.organization.name,
              slug: m.organization.slug,
            },
          ]
        : [],
    );
    return (
      <NotInWorkspace slug={slugFromUrl} otherWorkspaces={otherWorkspaces} />
    );
  }

  if (switchedElsewhere) {
    return (
      <AccessScreen title="This workspace was switched in another tab">
        <p className="max-w-md text-sm text-muted-foreground">
          You opened {organization?.name ?? "another workspace"} in another
          tab. Fabric works in one workspace at a time in a browser, so{" "}
          {matchingMembership.organization.name} is paused here.
        </p>
        <Button
          size="lg"
          onClick={() => void setActive?.({ organization: targetOrgId })}
          className={ACCESS_ACTION}
        >
          Continue in {matchingMembership.organization.name}
        </Button>
      </AccessScreen>
    );
  }

  // Don't mount org-scoped children until Convex confirms the JWT actually
  // carries the target org. This prevents first-render queries from throwing
  // "No active organization" while Clerk finishes activating the session.
  if (organization?.id !== targetOrgId || activeOrg?.orgId !== targetOrgId) {
    return <StallableLoading message="Loading workspace…" />;
  }

  return (
    <OrgThemeProvider>
      <WorkspaceAccess
        key={matchingMembership.organization.id}
        clerkOrgId={matchingMembership.organization.id}
        onSettled={setSettledOrgId}
      >
        {children}
      </WorkspaceAccess>
      <ThemeToaster />
    </OrgThemeProvider>
  );
}

/**
 * Provisions the caller's Fabric membership for the active org on every
 * workspace load, whatever page the visit starts on (a deep link included),
 * and only mounts the workspace once that membership exists. Existing members
 * don't wait for the refresh: their membership already resolves.
 */
function WorkspaceAccess({
  clerkOrgId,
  onSettled,
  children,
}: {
  clerkOrgId: string;
  onSettled: (clerkOrgId: string) => void;
  children: ReactNode;
}) {
  const membership = useQuery(api.users.getMyMembership);
  const joinStatus = useQuery(
    api.users.getMyJoinStatus,
    membership === null ? { clerkOrgId } : "skip",
  );
  const storeUser = useMutation(api.users.store);
  const syncProfile = useAction(api.users.syncCurrentUserFromClerk);
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<{
    attempt: number;
    ok: boolean;
  } | null>(null);
  const setup =
    outcome?.attempt === attempt ? (outcome.ok ? "done" : "failed") : "running";
  const membershipLoaded = membership !== undefined;
  const isNewMember = membership === null;

  useEffect(() => {
    if (!membershipLoaded) return;
    let cancelled = false;
    async function provision() {
      // An invite's role is matched by verified email, which the session
      // token may not carry. A first visit reads it from Clerk instead, so an
      // invited admin doesn't land as the default contributor.
      if (isNewMember) {
        try {
          await syncProfile();
        } catch (error) {
          console.error(
            "Failed to sync Fabric profile from Clerk; falling back to the session token",
            error,
          );
        }
      }
      // Resolves only once Convex queries reflect it, and so the sync too.
      await storeUser();
    }
    provision().then(
      () => {
        if (!cancelled) setOutcome({ attempt, ok: true });
      },
      (error: unknown) => {
        console.error("Failed to set up workspace membership", error);
        if (!cancelled) setOutcome({ attempt, ok: false });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [membershipLoaded, isNewMember, storeUser, syncProfile, attempt]);

  const hasMembership = !!membership;
  useEffect(() => {
    if (hasMembership) onSettled(clerkOrgId);
  }, [hasMembership, onSettled, clerkOrgId]);

  if (membership) {
    return (
      <>
        {children}
        <PasskeyOffer />
      </>
    );
  }

  if (membership === undefined) {
    return <StallableLoading message="Loading workspace…" />;
  }

  if (joinStatus?.blocked) {
    return (
      <AccessScreen title="Your access to this workspace was removed">
        <p className="max-w-md text-sm text-muted-foreground">
          A workspace admin removed you from this workspace. If you still need
          access, ask them to invite you again.
        </p>
        <SignOutLink />
      </AccessScreen>
    );
  }

  // `store` resolves only after Convex queries reflect it, so a finished
  // setup that still shows no membership is a real failure, not a race.
  if (setup === "failed" || (setup === "done" && joinStatus !== undefined)) {
    return (
      <AccessScreen title="We couldn't set up your access to this workspace">
        <p className="max-w-md text-sm text-muted-foreground">
          This is usually temporary. Try again in a moment, and if it keeps
          happening, contact your workspace admin.
        </p>
        <Button
          size="lg"
          onClick={() => setAttempt((n) => n + 1)}
          className={ACCESS_ACTION}
        >
          Try again
        </Button>
        <SignOutLink />
      </AccessScreen>
    );
  }

  return <StallableLoading message="Loading workspace…" />;
}

type Eligibility = { eligible: true } | { eligible: false; error: string };

/**
 * Signed in, but not a member of this subdomain's org. Asks the join API
 * first whether joining would work, so people who can't join see why
 * instead of a button that fails.
 */
function NotInWorkspace({
  slug,
  otherWorkspaces,
}: {
  slug: string;
  otherWorkspaces: WorkspaceLink[];
}) {
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/join-subdomain-organization", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as Eligibility;
      })
      // If the check itself fails, offer the button: joining gives the real
      // answer either way.
      .catch((): Eligibility => ({ eligible: true }))
      .then((result) => {
        if (!cancelled) setEligibility(result);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refused = eligibility?.eligible === false ? eligibility : null;

  return (
    <AccessScreen
      title={
        refused
          ? "You don't have access to this workspace"
          : "You're not in this workspace yet"
      }
    >
      <p className="max-w-md text-sm text-muted-foreground">
        {refused
          ? refused.error
          : eligibility
            ? `Your account isn't a member of ${slug} yet. You can join it now, or switch to a workspace you already belong to.`
            : `Checking whether your account can join ${slug}…`}
      </p>
      {eligibility?.eligible && <JoinWorkspaceButton />}
      {otherWorkspaces.length > 0 && (
        <div className="mt-2 flex flex-col items-center gap-2">
          <SectionLabel>Workspaces you can access</SectionLabel>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {otherWorkspaces.map((workspace) => (
              <a
                key={workspace.id}
                href={buildSubdomainUrl(workspace.slug)}
                className={buttonVariants({ variant: "outline" })}
              >
                {workspace.name}
              </a>
            ))}
          </div>
        </div>
      )}
      <SignOutLink />
    </AccessScreen>
  );
}

function AccessScreen({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 p-6 text-center">
      <PageTitle>{title}</PageTitle>
      {children}
    </div>
  );
}

function useStalled(afterMs: number): boolean {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setStalled(true), afterMs);
    return () => window.clearTimeout(timer);
  }, [afterMs]);
  return stalled;
}

/** A loading screen that offers Reload and Sign out once it has gone on too
 * long, so a stuck state is never a dead end. */
function StallableLoading({ message }: { message: string }) {
  const stalled = useStalled(STALLED_AFTER_MS);
  return (
    <LoadingScreen
      message={
        stalled ? `${message} This is taking longer than usual.` : message
      }
    >
      {stalled && (
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="lg"
            onClick={() => window.location.reload()}
          >
            Reload
          </Button>
          <SignOutLink />
        </div>
      )}
    </LoadingScreen>
  );
}

function JoinWorkspaceButton() {
  const { setActive } = useClerk();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJoin = async () => {
    setJoining(true);
    setError(null);
    try {
      const response = await fetch("/api/join-subdomain-organization", {
        method: "POST",
        cache: "no-store",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          data?.error ?? "We could not join this workspace. Please try again.",
        );
      }
      const data = (await response.json()) as { organizationId: string };
      await setActive({ organization: data.organizationId });
      // Full reload so useOrganizationList picks up the new membership and
      // the layout re-evaluates from a clean slate.
      window.location.reload();
    } catch (joinError) {
      setError(
        joinError instanceof Error
          ? joinError.message
          : "We could not join this workspace. Please try again.",
      );
      setJoining(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        size="lg"
        onClick={() => void handleJoin()}
        disabled={joining}
        className={ACCESS_ACTION}
      >
        {joining ? "Joining…" : "Join this workspace"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function SignOutLink() {
  const { signOut } = useClerk();
  return (
    <button
      type="button"
      onClick={() => signOut({ redirectUrl: "/sign-in" })}
      className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
    >
      Sign out
    </button>
  );
}
