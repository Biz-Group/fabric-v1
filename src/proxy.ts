import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getTenantSubdomain, isTenantsConsoleHost } from "@/lib/subdomain";

// Auth pages live only on tenant subdomains, never on apex. Apex is pure
// marketing.
const isAuthPath = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);
const isJoinOrganizationPath = createRouteMatcher([
  "/join-organization(.*)",
  "/api/join-subdomain-organization",
]);
// `isPublicPath` is what middleware lets through without an auth.protect.
// On the apex, only the marketing landing. On a subdomain, only auth pages and
// the signup org-join handoff are public — tenant `/` stays the workspace
// entrypoint and redirects signed-out users to `/sign-in`.
const isApexPublicPath = createRouteMatcher(["/"]);
const isSubdomainPublicPath = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
]);

// Root domain, with port for local dev. Dev: "lvh.me:3000", prod: "bizfabric.ai".
// Unset = treat every request as apex (legacy single-tenant dev without subdomains).
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "";

export default clerkMiddleware(
  async (auth, req) => {
    const host = req.headers.get("host");
    const subdomain = getTenantSubdomain(host, ROOT_DOMAIN);

    // Platform tenant-management console (tenants.<root>) — Biz Group staff
    // only. Auth pages render directly; the org-join handoff is meaningless
    // here (there's no tenant org), so it bounces to `/`, and everything else
    // is rewritten into the `src/app/tenants-console` tree behind auth.
    // Authorization (super-admin) is enforced by the console layout + every
    // Convex function it calls; middleware only guarantees authentication.
    if (isTenantsConsoleHost(host, ROOT_DOMAIN)) {
      if (isAuthPath(req)) return;
      if (isJoinOrganizationPath(req)) {
        const url = req.nextUrl.clone();
        url.pathname = "/";
        return NextResponse.redirect(url);
      }
      const url = req.nextUrl.clone();
      if (
        url.pathname === "/tenants-console" ||
        url.pathname.startsWith("/tenants-console/")
      ) {
        // Defensive — path already rewritten; don't double-prefix.
        await auth.protect();
        return;
      }
      url.pathname = `/tenants-console${url.pathname === "/" ? "" : url.pathname}`;
      await auth.protect();
      return NextResponse.rewrite(url);
    }

    // Apex request — marketing landing only. Anyone hitting /sign-in or
    // /sign-up on the apex gets redirected to the marketing page (sign-in is
    // a per-tenant flow, not a global one).
    if (!subdomain) {
      if (isAuthPath(req) || isJoinOrganizationPath(req)) {
        const url = req.nextUrl.clone();
        url.pathname = "/";
        return NextResponse.redirect(url);
      }
      if (!isApexPublicPath(req)) await auth.protect();
      return;
    }

    // Subdomain request → rewrite internally to /<subdomain>/<path> so the
    // Next.js `src/app/[org]/...` tree resolves. Auth pages and the signup
    // org-join handoff are NOT rewritten — they live at top-level routes and
    // render directly on each subdomain.
    if (isAuthPath(req) || isJoinOrganizationPath(req)) return;

    const url = req.nextUrl.clone();
    if (
      url.pathname === `/${subdomain}` ||
      url.pathname.startsWith(`/${subdomain}/`)
    ) {
      // Defensive — path already rewritten; don't double-prefix.
      if (!isSubdomainPublicPath(req)) await auth.protect();
      return;
    }
    url.pathname = `/${subdomain}${url.pathname}`;

    if (!isSubdomainPublicPath(req)) await auth.protect();
    return NextResponse.rewrite(url);
  },
  // No organizationSyncOptions: Clerk matches organization patterns against
  // the incoming (pre-rewrite) request path, but this app carries the org in
  // the subdomain — so `/:slug` patterns would misread ordinary path segments
  // (`/sign-in`, `/processes`, ...) as org slugs and could never activate the
  // right org. Activation is handled client-side by the `setActive` fallback
  // in `[org]/layout` instead.
);

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
