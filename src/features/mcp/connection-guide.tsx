"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** A read-only URL with a copy button. */
export function CopyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">{value}</code>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              toast.error("Couldn't copy the URL.");
            }
          }}
        >
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        </Button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** The workspace's connection URL and how to add it. One URL per workspace (M13). */
export function ConnectionGuide({ workspaceUrl }: { workspaceUrl: string | null }) {
  return (
    <div className="space-y-5">
      {workspaceUrl ? (
        <CopyField
          label="Connection URL"
          value={workspaceUrl}
          hint="Connects to this workspace only. If you belong to several Fabric workspaces, add one connector for each."
        />
      ) : (
        <p className="text-sm text-muted-foreground">This workspace has no connection URL yet. Contact Fabric support.</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="space-y-2 rounded-md border p-4">
          <h3 className="text-sm font-semibold">Claude</h3>
          <ol className="list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
            <li>Open Settings → Connectors → Add custom connector.</li>
            <li>Name it &ldquo;Fabric&rdquo; and paste the URL above.</li>
            <li>Click Connect and sign in with your Fabric account.</li>
            <li>In a chat, switch Fabric on from the tools menu and ask about your organization.</li>
          </ol>
          <p className="text-xs text-muted-foreground">
            On Claude Team and Enterprise, an owner may need to add the connector for the organization first.
          </p>
        </section>
        <section className="space-y-2 rounded-md border p-4">
          <h3 className="text-sm font-semibold">Microsoft Copilot</h3>
          <p className="text-sm text-muted-foreground">
            Coming soon. Your Microsoft 365 administrator will add Fabric for your organization; you then sign in with
            your Fabric account the first time you use it.
          </p>
        </section>
      </div>

      <p className="text-xs text-muted-foreground">
        The assistant sees only what you can see in Fabric. If it says it signed in but was refused, AI assistant access
        is switched off for that workspace: ask your Fabric admin.
      </p>
    </div>
  );
}
