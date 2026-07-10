"use client";

import { useAction, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { isValidTenantSlug } from "../../../../convex/lib/slugs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LogoFileButton } from "@/features/tenants-console/logo-file-button";
import { tenantHostname } from "@/features/tenants-console/tenant-url";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLE_OPTIONS = ["admin", "contributor", "viewer"] as const;
type Role = (typeof ROLE_OPTIONS)[number];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

function parseDomains(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,;]+/)
        .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
        .filter(Boolean),
    ),
  ];
}

export default function NewTenantPage() {
  const router = useRouter();
  const createTenant = useAction(api.tenants.createTenant);
  const generateLogoUploadUrl = useMutation(api.tenants.generateLogoUploadUrl);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [domainsInput, setDomainsInput] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [inviteFirstUser, setInviteFirstUser] = useState(false);
  const [firstUserEmail, setFirstUserEmail] = useState("");
  const [firstUserRole, setFirstUserRole] = useState<Role>("admin");
  const [submitting, setSubmitting] = useState(false);

  const effectiveSlug = slugTouched ? slug : slugify(name);
  const slugValid = effectiveSlug.length > 0 && isValidTenantSlug(effectiveSlug);
  const domains = useMemo(() => parseDomains(domainsInput), [domainsInput]);
  const logoPreview = useMemo(
    () => (logoFile ? URL.createObjectURL(logoFile) : null),
    [logoFile],
  );
  // Revoke the object URL when it changes or the page unmounts, so previewing
  // logos doesn't leak blob URLs.
  useEffect(() => {
    if (!logoPreview) return;
    return () => URL.revokeObjectURL(logoPreview);
  }, [logoPreview]);

  const canSubmit =
    name.trim().length > 0 &&
    slugValid &&
    (!inviteFirstUser || EMAIL_RE.test(firstUserEmail.trim())) &&
    !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      let logoStorageId: Id<"_storage"> | undefined;
      if (logoFile) {
        const uploadUrl = await generateLogoUploadUrl();
        const upload = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": logoFile.type },
          body: logoFile,
        });
        if (!upload.ok) throw new Error("Logo upload failed. Try again.");
        const uploaded = (await upload.json()) as {
          storageId: Id<"_storage">;
        };
        logoStorageId = uploaded.storageId;
      }

      const result = await createTenant({
        name: name.trim(),
        slug: effectiveSlug,
        allowedEmailDomains: domains,
        ...(logoStorageId ? { logoStorageId } : {}),
        ...(inviteFirstUser
          ? {
              firstInvite: {
                email: firstUserEmail.trim(),
                role: firstUserRole,
              },
            }
          : {}),
      });

      if (result.errors.length > 0) {
        toast.warning(
          `Tenant created, but ${result.errors.length} provisioning step(s) failed. See the tenant page to retry.`,
        );
      } else {
        toast.success(`Tenant "${name.trim()}" created.`);
      }
      router.push(`/${result.tenantId}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create the tenant.",
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">New tenant</h1>
        <p className="text-sm text-muted-foreground">
          Creates the Clerk organization, gives Biz Group super-admins access,
          and optionally invites the client&apos;s first user.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <CardDescription>
            The slug becomes the tenant&apos;s subdomain and can&apos;t be
            changed from the console later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Client name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Industries"
              autoFocus
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Slug
            </label>
            <Input
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
              placeholder="acme"
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">
              {effectiveSlug ? (
                slugValid ? (
                  <>
                    Workspace URL:{" "}
                    <span className="font-medium text-foreground">
                      {tenantHostname(effectiveSlug)}
                    </span>
                  </>
                ) : (
                  <span className="text-destructive">
                    This slug is reserved or invalid.
                  </span>
                )
              ) : (
                "Lowercase letters, numbers and hyphens."
              )}
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Logo (optional)
            </label>
            <div className="flex items-center gap-3">
              {logoPreview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoPreview}
                  alt="Logo preview"
                  className="h-10 w-10 rounded-md object-cover ring-1 ring-border"
                />
              )}
              <LogoFileButton
                label={logoFile ? "Change image" : "Choose image"}
                disabled={submitting}
                onSelect={setLogoFile}
              />
              {logoFile && (
                <>
                  <span className="max-w-48 truncate text-xs text-muted-foreground">
                    {logoFile.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={submitting}
                    onClick={() => setLogoFile(null)}
                  >
                    Remove
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Enrollment</CardTitle>
          <CardDescription>
            People with a verified email on these domains can join the
            workspace by signing up at its subdomain. Biz Group staff always
            have access; anyone else needs an invitation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Allowed email domains
            </label>
            <Input
              value={domainsInput}
              onChange={(e) => setDomainsInput(e.target.value)}
              placeholder="acme.com, acme.ae"
              disabled={submitting}
            />
          </div>
          {domains.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {domains.map((domain) => (
                <Badge key={domain} variant="outline">
                  @{domain}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Leave empty to keep this workspace invite-only (plus Biz Group
              staff).
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>First user</CardTitle>
          <CardDescription>
            Optionally email the client&apos;s first team member an invitation
            as soon as the workspace exists.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={inviteFirstUser}
              onChange={(e) => setInviteFirstUser(e.target.checked)}
              disabled={submitting}
              className="h-4 w-4 rounded border-border"
            />
            Invite a first user now
          </label>
          {inviteFirstUser && (
            <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
              <Input
                type="email"
                value={firstUserEmail}
                onChange={(e) => setFirstUserEmail(e.target.value)}
                placeholder="owner@acme.com"
                disabled={submitting}
              />
              <Select
                value={firstUserRole}
                onValueChange={(value) => setFirstUserRole(value as Role)}
                disabled={submitting}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((role) => (
                    <SelectItem key={role} value={role} className="capitalize">
                      {role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => router.push("/")}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!canSubmit}>
          {submitting ? "Creating..." : "Create tenant"}
        </Button>
      </div>
    </div>
  );
}
