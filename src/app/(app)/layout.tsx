import { ClerkProvider } from "@clerk/nextjs";
import { enGB } from "@clerk/localizations";
import { ui } from "@clerk/ui";
import { ConvexClientProvider } from "@/components/providers/convex-client-provider";
import { ThemeProvider } from "@/features/theming/theme-provider";

const clerkTaskUrls = {
  "choose-organization": "/join-organization",
};

/**
 * The signed-in product: tenant workspaces (`[org]`, reached by the proxy's
 * subdomain rewrite), the auth pages, organisation selection and the tenants
 * console. A route group, so URLs don't change. Clerk's own screens use its
 * British English text (`enGB`), matching the rest of Fabric.
 *
 * Clerk, Convex and the app theme load here rather than in the root layout, so
 * the public site (the landing page, `(site)`, `(legal)` and the site 404)
 * ships none of their JavaScript and never starts Clerk's client or its bot
 * probe. Server-side `auth()` comes from the proxy's `clerkMiddleware`, not
 * this provider, so it works on every route either way.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider localization={enGB} taskUrls={clerkTaskUrls} ui={ui}>
      <ConvexClientProvider>
        <ThemeProvider>{children}</ThemeProvider>
      </ConvexClientProvider>
    </ClerkProvider>
  );
}
