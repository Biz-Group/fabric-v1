"use client";

import { useAuth } from "@clerk/nextjs";
import {
  ConvexProviderWithAuth,
  ConvexReactClient,
  useConvexAuth,
} from "convex/react";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// Bumped to make Convex re-run `setAuth` with a fresh token fetcher.
const AuthRetryContext = createContext(0);

// Backoff between attempts to recover a Convex session Clerk still considers
// signed in. The last delay repeats until a refresh succeeds.
const RECOVERY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000];

// Retries inside a single token fetch (~2 minutes in total). Reporting a
// failure makes Convex drop auth, which re-renders the workspace as
// "Reconnecting…" and unmounts whatever is open — including a live interview,
// whose ElevenLabs call ends on unmount. So a refresh that fails while Clerk
// still says the session is alive keeps trying instead; meanwhile Convex keeps
// the current token or pauses its socket with data still on screen.
const TOKEN_FETCH_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 30_000, 30_000];

const sleep = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * Same bridge as `convex/react-clerk`'s ConvexProviderWithClerk, plus a retry
 * key. Stock Convex only re-authenticates when the Clerk session, org or role
 * changes, so a single failed background token refresh (laptop waking before
 * Wi-Fi, a brief Clerk outage) left the app signed out of Convex until a
 * reload. Changing `retryNonce` builds a new fetcher, which re-runs setAuth.
 */
function useAuthFromClerk() {
  const retryNonce = useContext(AuthRetryContext);
  const {
    isLoaded,
    isSignedIn,
    getToken,
    orgId,
    orgRole,
    sessionId,
    sessionClaims,
  } = useAuth();
  // Read inside the retry loop, so a real sign-out stops it straight away.
  const signedInRef = useRef(isSignedIn);
  useEffect(() => {
    signedInRef.current = isSignedIn;
  }, [isSignedIn]);

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      const fetchOnce = async () => {
        try {
          if (sessionClaims?.aud === "convex") {
            return await getToken({ skipCache: forceRefreshToken });
          }
          return await getToken({
            template: "convex",
            skipCache: forceRefreshToken,
          });
        } catch {
          return null;
        }
      };

      let token = await fetchOnce();
      for (const delay of TOKEN_FETCH_RETRY_DELAYS_MS) {
        if (token || !signedInRef.current) break;
        await sleep(delay);
        if (!signedInRef.current) break;
        token = await fetchOnce();
      }
      return token;
    },
    // Mirrors convex/react-clerk: a new fetcher triggers setAuth(), so the
    // deps are exactly the things that should re-authenticate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orgId, orgRole, sessionId, retryNonce],
  );
  return useMemo(
    () => ({
      isLoading: !isLoaded,
      isAuthenticated: isSignedIn ?? false,
      fetchAccessToken,
    }),
    [isLoaded, isSignedIn, fetchAccessToken],
  );
}

/** Retries Convex auth while Clerk is signed in but Convex is not. */
function ConvexAuthRecovery({ onRetry }: { onRetry: () => void }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const attempts = useRef(0);
  const stalled = isLoaded && !!isSignedIn && !isLoading && !isAuthenticated;

  useEffect(() => {
    if (isAuthenticated) attempts.current = 0;
  }, [isAuthenticated]);

  useEffect(() => {
    if (!stalled) return;
    const delay =
      RECOVERY_DELAYS_MS[Math.min(attempts.current, RECOVERY_DELAYS_MS.length - 1)];
    attempts.current += 1;
    const timer = window.setTimeout(onRetry, delay);
    const retryWhenVisible = () => {
      if (document.visibilityState === "visible") onRetry();
    };
    window.addEventListener("online", onRetry);
    document.addEventListener("visibilitychange", retryWhenVisible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", onRetry);
      document.removeEventListener("visibilitychange", retryWhenVisible);
    };
  }, [stalled, onRetry]);

  return null;
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) {
      throw new Error(
        "NEXT_PUBLIC_CONVEX_URL is not set. Configure it in the environment before starting the app.",
      );
    }
    return new ConvexReactClient(url);
  }, []);
  const [retryNonce, setRetryNonce] = useState(0);
  const retryAuth = useCallback(() => setRetryNonce((n) => n + 1), []);

  return (
    <AuthRetryContext.Provider value={retryNonce}>
      <ConvexProviderWithAuth client={client} useAuth={useAuthFromClerk}>
        <ConvexAuthRecovery onRetry={retryAuth} />
        {children}
      </ConvexProviderWithAuth>
    </AuthRetryContext.Provider>
  );
}
