import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { getTenantSubdomain } from "@/lib/subdomain";

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "";

// Platform staff (Biz Group) may join every tenant workspace by default.
// Comma-separated env override; defaults to the Biz Group corporate domain.
const PLATFORM_STAFF_EMAIL_DOMAINS = (
  process.env.PLATFORM_STAFF_EMAIL_DOMAINS ?? "bizgroup.ae"
)
  .split(",")
  .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
  .filter(Boolean);

type ClerkApiError = {
  errors?: Array<{ code?: string }>;
};

function isAlreadyMemberError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;

  const errors = (error as ClerkApiError).errors;
  return (
    Array.isArray(errors) &&
    errors.some((entry) => entry.code === "already_a_member_in_organization")
  );
}

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

  const fetchSite = req.headers.get("sec-fetch-site");
  return (
    fetchSite === null || fetchSite === "same-origin" || fetchSite === "none"
  );
}

function getVerifiedEmails(user: {
  emailAddresses: Array<{
    emailAddress: string;
    verification?: { status?: string | null } | null;
  }>;
}): string[] {
  return user.emailAddresses
    .filter((email) => email.verification?.status === "verified")
    .map((email) => email.emailAddress.toLowerCase());
}

function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at === -1 || at === email.length - 1) return null;
  return email.slice(at + 1);
}

/** Per-tenant enrollment domains, managed in Clerk org public metadata as
 * `allowedEmailDomains: string[]` (set at tenant creation in the Clerk
 * dashboard, or via `platform:setOrgAllowedEmailDomains`). Missing/malformed
 * metadata yields [] — i.e. the tenant is closed to everyone except platform
 * staff and invited users. */
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
//   2. a platform-staff domain (PLATFORM_STAFF_EMAIL_DOMAINS, Biz Group), or
//   3. — failing both — the org has a pending Clerk invitation for one of the
//      caller's verified emails (escape hatch for out-of-domain externals).
// The Fabric app role still comes from Convex (`membershipIntents` when an
// admin invited them, `viewer` otherwise); Clerk membership only grants entry
// to the workspace shell.
export async function POST(req: NextRequest) {
  if (!isSameOriginPost(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const slug = getTenantSubdomain(req.headers.get("host"), ROOT_DOMAIN);
  if (!slug) {
    return NextResponse.json(
      { error: "A workspace subdomain is required." },
      { status: 400 },
    );
  }

  const { userId } = await auth({
    treatPendingAsSignedOut: false,
  });
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const client = await clerkClient();
  let organization;
  try {
    organization = await client.organizations.getOrganization({ slug });
  } catch {
    logBlockedJoin({ slug, userId, reason: "organization_not_found" });
    return NextResponse.json(
      { error: "Workspace not found for this subdomain." },
      { status: 404 },
    );
  }

  const targetMembership =
    await client.organizations.getOrganizationMembershipList({
      organizationId: organization.id,
      userId: [userId],
      limit: 1,
    });

  if (targetMembership.data.length === 0) {
    const user = await client.users.getUser(userId);
    if (user.banned || user.locked) {
      logBlockedJoin({ slug, userId, reason: "banned_or_locked" });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const verifiedEmails = getVerifiedEmails(user);
    if (verifiedEmails.length === 0) {
      logBlockedJoin({ slug, userId, reason: "no_verified_email" });
      return NextResponse.json(
        { error: "Verify your email before joining this workspace." },
        { status: 403 },
      );
    }

    const allowedDomains = new Set([
      ...PLATFORM_STAFF_EMAIL_DOMAINS,
      ...allowedDomainsFromOrg(organization),
    ]);
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
        logBlockedJoin({ slug, userId, reason: "email_domain_not_allowed" });
        return NextResponse.json(
          {
            error:
              "This workspace is limited to approved email domains. Sign up with your work email, or ask a workspace admin to invite you.",
          },
          { status: 403 },
        );
      }
    }

    try {
      await client.organizations.createOrganizationMembership({
        organizationId: organization.id,
        userId,
        role: "org:member",
      });
    } catch (error) {
      if (!isAlreadyMemberError(error)) {
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
