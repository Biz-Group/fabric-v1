import {
  auth,
  clerkClient,
  type Organization,
} from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { NextResponse, type NextRequest } from "next/server";
import { getTenantSubdomain } from "@/lib/subdomain";
import { api } from "../../../../convex/_generated/api";

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "";

// Clerk test-mode addresses (`name+clerk_test@domain`) "verify" with a fixed
// code and no mailbox. On a live instance they must never satisfy the domain
// gate, even if test mode is left switched on in the Clerk dashboard.
const IS_LIVE_CLERK_INSTANCE = (process.env.CLERK_SECRET_KEY ?? "")
  .trim()
  .startsWith("sk_live_");

function isClerkTestEmail(email: string): boolean {
  const localPart = email.slice(0, email.lastIndexOf("@"));
  return localPart.includes("+clerk_test");
}

type ClerkApiError = {
  errors?: Array<{ code?: string }>;
};

function hasClerkErrorCode(error: unknown, code: string): boolean {
  if (typeof error !== "object" || error === null) return false;

  const errors = (error as ClerkApiError).errors;
  return Array.isArray(errors) && errors.some((entry) => entry.code === code);
}

// Browsers send `Origin` on every POST, same-origin included, and modern ones
// also send `Sec-Fetch-Site`. A request with neither didn't come from our
// page, so refuse it rather than assume it's safe.
function isSameOriginPost(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return (
        new URL(origin).host.toLowerCase() === req.nextUrl.host.toLowerCase()
      );
    } catch {
      return false;
    }
  }

  return req.headers.get("sec-fetch-site") === "same-origin";
}

function getVerifiedEmails(user: {
  emailAddresses: Array<{
    emailAddress: string;
    verification?: { status?: string | null } | null;
  }>;
}): string[] {
  return user.emailAddresses
    .filter((email) => email.verification?.status === "verified")
    .map((email) => email.emailAddress.toLowerCase())
    .filter((email) => !(IS_LIVE_CLERK_INSTANCE && isClerkTestEmail(email)));
}

function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at === -1 || at === email.length - 1) return null;
  return email.slice(at + 1);
}

/** Per-tenant enrollment domains, managed in Clerk org public metadata as
 * `allowedEmailDomains: string[]` (set at tenant creation in the Clerk
 * dashboard, or via `platform:setOrgAllowedEmailDomains`). Missing/malformed
 * metadata yields [] — i.e. the tenant is closed to everyone except invited
 * users. */
function allowedDomainsFromOrg(organization: {
  publicMetadata?: Record<string, unknown> | null;
}): string[] {
  const raw = organization.publicMetadata?.allowedEmailDomains;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

// Returns true if the org has a pending invitation addressed to one of the
// caller's verified emails. Matching only *verified* emails is what makes this
// safe: a user cannot match an invitation for an address they don't own,
// because Clerk requires email-ownership verification.
async function hasPendingInvitationFor(
  client: Awaited<ReturnType<typeof clerkClient>>,
  organizationId: string,
  verifiedEmails: string[],
): Promise<boolean> {
  if (verifiedEmails.length === 0) return false;

  const verified = new Set(verifiedEmails);
  const limit = 100;
  let offset = 0;

  for (;;) {
    const page = await client.organizations.getOrganizationInvitationList({
      organizationId,
      status: ["pending"],
      limit,
      offset,
    });

    if (
      page.data.some((invitation) =>
        verified.has(invitation.emailAddress.toLowerCase()),
      )
    ) {
      return true;
    }

    offset += page.data.length;
    if (page.data.length < limit || offset >= page.totalCount) {
      return false;
    }
  }
}

// Rejections here surface as support escalations ("I can't get into my
// workspace"), so log the reason server-side — the 403 body only reaches the
// end user.
function logBlockedJoin(details: {
  slug: string | null;
  userId: string | null;
  reason: string;
}) {
  console.warn(`[join-subdomain-organization] blocked: ${JSON.stringify(details)}`);
}

// Enrollment policy: DOMAIN-GATED. A signed-in account may join the tenant
// org resolved from the subdomain when any of its *verified* email domains is
//   1. in the tenant's `allowedEmailDomains` (Clerk org public metadata), or
//   2. — failing that — the org has a pending Clerk invitation for one of the
//      caller's verified emails (escape hatch for out-of-domain externals).
// There is deliberately no platform-staff domain shortcut: Biz Group staff
// reach client tenants only through the super-admin fan-out
// (`platform.fanOutSuperAdminMemberships`), never by email domain.
// The Fabric app role still comes from Convex (`membershipIntents` when an
// admin invited them, `contributor` otherwise); Clerk membership only grants
// entry to the workspace shell.

type JoinDecision =
  | { kind: "member"; organization: Organization }
  | { kind: "eligible"; organization: Organization }
  | { kind: "refused"; status: number; reason: string; error: string };

type Caller = Awaited<ReturnType<typeof auth>> & { userId: string };

/** Applies the enrollment policy without changing anything. */
async function decideJoin(
  client: Awaited<ReturnType<typeof clerkClient>>,
  slug: string,
  { userId, getToken }: Caller,
): Promise<JoinDecision> {
  let organization: Organization;
  try {
    organization = await client.organizations.getOrganization({ slug });
  } catch {
    return {
      kind: "refused",
      status: 404,
      reason: "organization_not_found",
      error: "Workspace not found for this subdomain.",
    };
  }

  const targetMembership =
    await client.organizations.getOrganizationMembershipList({
      organizationId: organization.id,
      userId: [userId],
      limit: 1,
    });
  if (targetMembership.data.length > 0) return { kind: "member", organization };

  const user = await client.users.getUser(userId);
  if (user.banned || user.locked) {
    return {
      kind: "refused",
      status: 403,
      reason: "banned_or_locked",
      error: "Your account can't join this workspace. Contact a workspace admin.",
    };
  }

  const verifiedEmails = getVerifiedEmails(user);
  if (verifiedEmails.length === 0) {
    return {
      kind: "refused",
      status: 403,
      reason: "no_verified_email",
      error: "Verify your email before joining this workspace.",
    };
  }

  const allowedDomains = new Set(allowedDomainsFromOrg(organization));
  const domainAllowed = verifiedEmails.some((email) => {
    const domain = emailDomain(email);
    return domain !== null && allowedDomains.has(domain);
  });

  if (!domainAllowed) {
    const invited = await hasPendingInvitationFor(
      client,
      organization.id,
      verifiedEmails,
    );
    if (!invited) {
      return {
        kind: "refused",
        status: 403,
        reason: "email_domain_not_allowed",
        error:
          "This workspace is limited to approved email domains. Sign up with your work email, or ask a workspace admin to invite you.",
      };
    }
  }

  // A member an admin removed stays out until re-invited, even though their
  // email domain still matches. Convex enforces that on its own (`store`
  // and the membership webhook refuse a removed member), so this check is
  // for a clear answer and to avoid spending a Clerk seat. If the status
  // can't be read, fall through and let Convex decide.
  let blocked = false;
  try {
    const token = await getToken({ template: "convex" });
    if (token) {
      ({ blocked } = await fetchQuery(
        api.users.getMyJoinStatus,
        { clerkOrgId: organization.id },
        { token },
      ));
    } else {
      console.warn(
        `[join-subdomain-organization] no Convex token: ${JSON.stringify({ slug, userId })}`,
      );
    }
  } catch (error) {
    console.warn(
      `[join-subdomain-organization] join status unavailable: ${JSON.stringify({
        slug,
        userId,
        errorType: error instanceof Error ? error.name : "UnknownError",
      })}`,
    );
  }
  if (blocked) {
    return {
      kind: "refused",
      status: 403,
      reason: "removed_by_admin",
      error:
        "Your access to this workspace was removed. Ask a workspace admin to invite you again.",
    };
  }

  return { kind: "eligible", organization };
}

async function resolveCaller(
  req: NextRequest,
): Promise<{ slug: string; caller: Caller } | NextResponse> {
  const slug = getTenantSubdomain(req.headers.get("host"), ROOT_DOMAIN);
  if (!slug) {
    return NextResponse.json(
      { error: "A workspace subdomain is required." },
      { status: 400 },
    );
  }

  const session = await auth({ treatPendingAsSignedOut: false });
  if (!session.userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  return { slug, caller: session as Caller };
}

// Clerk SDK errors carry Clerk's messages and metadata, which can include
// email addresses. Log only what identifies the failure for support.
function logUnexpectedFailure(stage: string, error: unknown) {
  const { status, errors, clerkTraceId } = (
    typeof error === "object" && error !== null ? error : {}
  ) as { status?: unknown; errors?: unknown; clerkTraceId?: unknown };
  console.error(
    `[join-subdomain-organization] ${stage} failed: ${JSON.stringify({
      errorType: error instanceof Error ? error.name : typeof error,
      status: typeof status === "number" ? status : undefined,
      codes: Array.isArray(errors)
        ? errors.flatMap((entry: { code?: unknown } | null) =>
            typeof entry?.code === "string" ? [entry.code] : [],
          )
        : undefined,
      clerkTraceId: typeof clerkTraceId === "string" ? clerkTraceId : undefined,
    })}`,
  );
}

/**
 * Pre-check for the "Join this workspace" button: whether joining would
 * succeed, and if not, the reason to show instead. Changes nothing.
 */
export async function GET(req: NextRequest) {
  try {
    return await checkEligibility(req);
  } catch (error) {
    logUnexpectedFailure("eligibility check", error);
    return NextResponse.json(
      { error: "We couldn't check this workspace right now. Please try again." },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    return await join(req);
  } catch (error) {
    logUnexpectedFailure("join", error);
    return NextResponse.json(
      {
        error:
          "We couldn't add you to this workspace right now. Please try again.",
      },
      { status: 500 },
    );
  }
}

async function checkEligibility(req: NextRequest) {
  const resolved = await resolveCaller(req);
  if (resolved instanceof NextResponse) return resolved;

  const decision = await decideJoin(
    await clerkClient(),
    resolved.slug,
    resolved.caller,
  );
  return NextResponse.json(
    decision.kind === "refused"
      ? { eligible: false, error: decision.error }
      : { eligible: true },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

async function join(req: NextRequest) {
  if (!isSameOriginPost(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const resolved = await resolveCaller(req);
  if (resolved instanceof NextResponse) return resolved;
  const { slug, caller } = resolved;
  const { userId } = caller;

  const client = await clerkClient();
  const decision = await decideJoin(client, slug, caller);
  if (decision.kind === "refused") {
    logBlockedJoin({ slug, userId, reason: decision.reason });
    return NextResponse.json(
      { error: decision.error },
      { status: decision.status },
    );
  }

  const { organization } = decision;
  if (decision.kind === "eligible") {
    try {
      await client.organizations.createOrganizationMembership({
        organizationId: organization.id,
        userId,
        role: "org:member",
      });
    } catch (error) {
      // Pending invitations count toward Clerk's per-workspace member limit,
      // so a full workspace is an expected state, not a server error.
      if (hasClerkErrorCode(error, "organization_membership_quota_exceeded")) {
        logBlockedJoin({ slug, userId, reason: "membership_quota_exceeded" });
        return NextResponse.json(
          {
            error:
              "This workspace has reached its member limit. Ask a workspace admin to free up a seat, then try again.",
          },
          { status: 409 },
        );
      }
      if (!hasClerkErrorCode(error, "already_a_member_in_organization")) {
        logBlockedJoin({ slug, userId, reason: "clerk_membership_create_failed" });
        throw error;
      }
    }
  }

  return NextResponse.json({
    organizationId: organization.id,
    slug: organization.slug,
  });
}
