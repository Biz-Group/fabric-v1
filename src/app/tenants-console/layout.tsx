"use client";

import { useAuth, useClerk, useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { LoadingScreen } from "@/components/ui/loading-screen";
import { PageTitle } from "@/components/ui/page-title";
import { ThemeToaster } from "@/features/theming/theme-toaster";
import { ThemeToggle } from "@/features/theming/theme-toggle";

// Middleware guarantees authentication for every route on this host; this
// layout enforces *authorization*: only platform super-admins may see the
// console. Every Convex function behind it re-checks server-side, so this
// gate is UX, not security.
export default function TenantsConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoaded, isSignedIn } = useUser();
  // `useUser` counts a pending session (org not chosen yet) as signed in;
  // Convex only authenticates an active one.
  const { isSignedIn: hasActiveSession } = useAuth();
  const { redirectToSignIn } = useClerk();
  const { isAuthenticated, isLoading: convexAuthLoading } = useConvexAuth();
  const me = useQuery(api.users.getMe);
  const storeUser = useMutation(api.users.store);

  // Ensure the Convex user row exists for a staff member whose first visit
  // is the console itself (requireSuperAdmin needs the row).
  useEffect(() => {
    if (isLoaded && isSignedIn && isAuthenticated) void storeUser();
  }, [isLoaded, isSignedIn, isAuthenticated, storeUser]);

  // The session can end while the console is open (expiry, sign-out in
  // another tab); send the user to sign in rather than leaving them here.
  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      void redirectToSignIn({ redirectUrl: window.location.href });
    }
  }, [isLoaded, isSignedIn, redirectToSignIn]);

  if (!isLoaded || convexAuthLoading) {
    return <LoadingScreen message="Loading tenant console…" />;
  }

  if (!isSignedIn) {
    return <LoadingScreen message="Redirecting to sign in…" />;
  }

  // Convex dropped the session (e.g. a token refresh failed while offline):
  // `getMe` reads null then, which must not look like "access denied".
  // ConvexClientProvider retries on its own.
  if (hasActiveSession && !isAuthenticated) {
    return <LoadingScreen message="Reconnecting to the tenant console…" />;
  }

  if (me === undefined) {
    return <LoadingScreen message="Loading tenant console…" />;
  }

  if (!me || me.platformRole !== "superAdmin") {
    return <AccessBlocker />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <ConsoleHeader email={me.email} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
      <ThemeToaster />
    </div>
  );
}

function ConsoleHeader({ email }: { email: string }) {
  const pathname = usePathname();
  // The browser path has no /tenants-console prefix (middleware rewrite), but
  // normalize defensively in case this renders from the internal path.
  const path = pathname?.replace(/^\/tenants-console/, "") || "/";
  const { signOut } = useClerk();

  const navItems = [
    { href: "/", label: "Tenants", active: path === "/" || path.startsWith("/new") },
    { href: "/usage", label: "Usage", active: path.startsWith("/usage") },
    { href: "/team", label: "Platform team", active: path.startsWith("/team") },
  ];

  return (
    <header className="border-b border-border bg-card">
      {/* One row from lg. Below that the nav drops to a second row under the
          brand and account controls, and the email hides on phones, so
          nothing overflows at 360px. */}
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:gap-x-8">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-semibold">Fabric</span>
          <span className="text-sm text-muted-foreground">Tenant console</span>
        </div>
        <nav className="order-last flex w-full items-center gap-1 lg:order-none lg:w-auto">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className={
                item.active
                  ? "rounded-md bg-muted px-3 py-1.5 text-sm font-medium"
                  : "rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block">
            {email}
          </span>
          <ThemeToggle />
          <Button
            variant="outline"
            size="sm"
            onClick={() => signOut({ redirectUrl: "/sign-in" })}
          >
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}

function AccessBlocker() {
  const { signOut } = useClerk();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <PageTitle>Platform access required</PageTitle>
      <p className="max-w-md text-sm text-muted-foreground">
        The tenant console is available to Fabric platform super-admins only.
        If you believe you should have access, ask an existing super-admin to
        promote your account.
      </p>
      <button
        type="button"
        onClick={() => signOut({ redirectUrl: "/sign-in" })}
        className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        Sign out
      </button>
    </div>
  );
}
