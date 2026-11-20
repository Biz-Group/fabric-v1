"use client";

import { useAction, useQuery } from "convex/react";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { GuideHeader } from "@/features/mcp/connection-guide";
import { CopyButton, MenuPath, OpenAppLink, Step, StepHint, Steps, ValueRow, Values } from "@/features/mcp/setup-steps";
import { describeError } from "@/lib/user-error-message";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
export const COPILOT_STUDIO_URL = "https://copilotstudio.microsoft.com";

/** A freshly created or regenerated secret. Fabric never stores it, so it lives only in page state until dismissed. */
export type RevealedSecret = { clientId: string; clientSecret: string };

/**
 * Admin → MCP → Microsoft Copilot Studio (B7) as a guided setup. The workspace
 * gets its own OAuth client for Copilot Studio's "OAuth 2.0 → Manual" MCP
 * connection; each connector then has its own callback URL to add here.
 *
 * Every step stays visible, in the order Copilot Studio's MCP wizard asks for
 * things, with value labels matching its field names. The one-time secret is
 * shown in its own row in step 3 (`secret`, held by the parent so switching
 * tabs doesn't lose it).
 */
export function CopilotStudioSteps({
  secret,
  onSecret,
  usedClientIds,
}: {
  secret: RevealedSecret | null;
  onSecret: (secret: RevealedSecret | null) => void;
  /** Client ids with MCP calls in the last 30 days, from the page's usage query. */
  usedClientIds: ReadonlySet<string> | undefined;
}) {
  const setup = useQuery(api.mcpClients.copilotStudioSetup);
  const create = useAction(api.mcpClients.createCopilotStudioClient);
  const addCallback = useAction(api.mcpClients.addCallbackUrl);
  const removeCallback = useAction(api.mcpClients.removeCallbackUrl);
  const regenerate = useAction(api.mcpClients.regenerateSecret);
  const remove = useAction(api.mcpClients.deleteCopilotStudioClient);
  const [callback, setCallback] = useState("");
  const [confirm, setConfirm] = useState<"regenerate" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);

  // `ok` tells success from failure; several actions return null when they succeed.
  const run = async <T,>(action: () => Promise<T>, done?: string): Promise<{ ok: true; value: T } | { ok: false }> => {
    setBusy(true);
    try {
      const value = await action();
      if (done) toast.success(done);
      return { ok: true, value };
    } catch (error) {
      toast.error(describeError(error, "That didn't work. Try again."));
      return { ok: false };
    } finally {
      setBusy(false);
    }
  };

  if (setup === undefined) return <Skeleton className="h-96 w-full" />;
  if (!setup.available) return null;
  const { client } = setup;
  // A secret from before a delete-and-recreate elsewhere would be the wrong one.
  const shownSecret = secret && client && secret.clientId === client.clientId ? secret.clientSecret : null;
  const used = client ? (usedClientIds?.has(client.clientId) ?? false) : false;
  const pending = "Created in step 1";

  return (
    <div className="space-y-5">
      <GuideHeader intro="Do this once for each Copilot Studio agent. You'll need edit access to the agent.">
        <OpenAppLink href={COPILOT_STUDIO_URL}>Open Copilot Studio</OpenAppLink>
      </GuideHeader>

      <Steps>
        <Step n={1} title="Create Fabric credentials" done={!!client}>
          {client ? (
            <StepHint>
              A client ID and secret for this workspace only. Created
              {client.createdByName ? ` by ${client.createdByName}` : ""} on {dateFormat.format(client.createdAt)}.
            </StepHint>
          ) : (
            <>
              <StepHint>A client ID and secret that work for this workspace only.</StepHint>
              <Button
                size="sm"
                disabled={busy}
                onClick={async () => {
                  const created = await run(() => create({}), "Credentials created. Copy the secret in step 3.");
                  if (created.ok) onSecret(created.value);
                }}
              >
                {busy && <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden />}
                Create credentials
              </Button>
            </>
          )}
        </Step>

        <Step n={2} title="Add Fabric as a tool in your agent">
          <MenuPath label="In your agent:" items={["Tools", "Add a tool", "New tool", "Model Context Protocol"]} />
          <Values>
            <ValueRow label="Server name" value={setup.serverName} />
            <ValueRow label="Server description" value={setup.serverDescription} />
            <ValueRow label="Server URL" value={setup.serverUrl} />
          </Values>
        </Step>

        <Step n={3} title="Set up sign-in">
          <MenuPath label="Choose:" items={["OAuth 2.0", "Manual"]} />
          <Values>
            {client ? (
              <ValueRow label="Client ID" value={client.clientId} />
            ) : (
              <ValueRow label="Client ID">
                <PendingValue text={pending} />
              </ValueRow>
            )}
            {shownSecret ? (
              <ValueRow label="Client secret" tone="warning">
                <code className="min-w-0 flex-1 truncate font-mono text-xs" title={shownSecret}>
                  {shownSecret}
                </code>
                <CopyButton value={shownSecret} label="Client secret" className="-mr-1.5 shrink-0" />
              </ValueRow>
            ) : (
              <ValueRow label="Client secret">
                {client ? (
                  <>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      Hidden: it&rsquo;s shown only once
                    </span>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="-mr-1.5 shrink-0"
                      disabled={busy}
                      onClick={() => setConfirm("regenerate")}
                    >
                      Regenerate
                    </Button>
                  </>
                ) : (
                  <PendingValue text={pending} />
                )}
              </ValueRow>
            )}
            <ValueRow label="Authorization URL" value={setup.authorizationUrl} />
            <ValueRow label="Token URL template" value={setup.tokenUrl} />
            <ValueRow label="Refresh URL" value={setup.tokenUrl} />
            <ValueRow label="Scopes" value={setup.scopes} />
          </Values>
          {shownSecret && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning-border bg-warning-subtle px-3 py-2 text-xs">
              <span>
                <span className="font-medium">Copy the secret now.</span> Fabric doesn&rsquo;t keep it, so it disappears when you
                leave this page.
              </span>
              <Button variant="outline" size="xs" onClick={() => onSecret(null)}>
                I&rsquo;ve copied it
              </Button>
            </div>
          )}
          <StepHint>Then select Create in Copilot Studio.</StepHint>
        </Step>

        <Step
          n={4}
          title="Paste Copilot Studio's callback URL here"
          done={!!client && client.callbackUrls.length > 0}
          status={client && client.callbackUrls.length > 0 ? `${client.callbackUrls.length} added` : undefined}
        >
          <StepHint>
            After Create, Copilot Studio shows a Callback URL. Sign-in fails until it&rsquo;s added. Each agent has its own.
          </StepHint>
          {client && client.callbackUrls.length > 0 && (
            <Values>
              {client.callbackUrls.map((url, i) => (
                <ValueRow key={url} label={`Connector ${i + 1}`}>
                  <code className="min-w-0 flex-1 truncate font-mono text-xs" title={url}>
                    {url}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="-mr-1.5 shrink-0"
                    aria-label="Remove callback URL"
                    title="Remove"
                    disabled={busy}
                    onClick={() => run(() => removeCallback({ url }), "Callback URL removed.")}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </ValueRow>
              ))}
            </Values>
          )}
          <form
            className="flex gap-2"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!callback.trim()) return;
              const added = await run(() => addCallback({ url: callback.trim() }), "Callback URL added.");
              if (added.ok) setCallback("");
            }}
          >
            <Input
              value={callback}
              onChange={(event) => setCallback(event.target.value)}
              placeholder="https://global.consent.azure-apim.net/redirect/…"
              aria-label="Callback URL"
              disabled={!client}
              className="h-8 font-mono text-xs"
            />
            <Button type="submit" variant="outline" disabled={busy || !client || !callback.trim()}>
              Add
            </Button>
          </form>
        </Step>

        <Step n={5} title="Connect and try it" done={used} status={used ? "Used in the last 30 days" : undefined}>
          <MenuPath label="In Copilot Studio:" items={["Next", "Create a new connection", "Add to agent"]} />
          <StepHint>Sign in with your Fabric account when asked, then ask the agent about your organisation.</StepHint>
        </Step>
      </Steps>

      {client && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            {client.secretRotatedAt
              ? `Secret last regenerated ${dateFormat.format(client.secretRotatedAt)}.`
              : "Regenerating the secret means updating every connector that uses it."}
          </p>
          <Button variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => setConfirm("delete")}>
            Delete credentials
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirm === "regenerate"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Regenerate the client secret?"
        description="The current secret stops working at once. Every Copilot Studio connector using it needs the new one."
        confirmLabel="Regenerate"
        destructive
        onConfirm={async () => {
          const rotated = await run(() => regenerate({}), "New secret created. Copy it in step 3.");
          if (rotated.ok) onSecret(rotated.value);
        }}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Delete the Copilot Studio credentials?"
        description="Every Copilot Studio connector using them stops working at once."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          const deleted = await run(() => remove({}), "Copilot Studio credentials deleted.");
          if (deleted.ok) onSecret(null);
        }}
      />
    </div>
  );
}

function PendingValue({ text }: { text: string }) {
  return <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground italic">{text}</span>;
}
