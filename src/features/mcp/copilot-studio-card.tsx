"use client";

import { useAction, useQuery } from "convex/react";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CopyField } from "@/features/mcp/connection-guide";
import { describeError } from "@/lib/user-error-message";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/**
 * Admin → MCP → Microsoft Copilot Studio (B7): the workspace's own OAuth
 * client for Copilot Studio's "OAuth 2.0 → Manual" MCP connection, and the
 * callback URL of each connector that uses it.
 */
export function CopilotStudioCard() {
  const setup = useQuery(api.mcpClients.copilotStudioSetup);
  const create = useAction(api.mcpClients.createCopilotStudioClient);
  const addCallback = useAction(api.mcpClients.addCallbackUrl);
  const removeCallback = useAction(api.mcpClients.removeCallbackUrl);
  const regenerate = useAction(api.mcpClients.regenerateSecret);
  const remove = useAction(api.mcpClients.deleteCopilotStudioClient);
  const [secret, setSecret] = useState<{ clientId: string; clientSecret: string } | null>(null);
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

  if (!setup || !setup.available) return null;
  const { client } = setup;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Microsoft Copilot Studio</CardTitle>
        <CardDescription>
          Add Fabric to any Copilot Studio agent as a Model Context Protocol tool. These credentials work only for this
          workspace.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!client ? (
          <Button
            disabled={busy}
            onClick={async () => {
              const created = await run(() => create({}));
              if (created.ok) setSecret(created.value);
            }}
          >
            Create Copilot Studio credentials
          </Button>
        ) : (
          <>
            <ol className="list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
              <li>In Copilot Studio, open your agent, then Tools → Add a tool → Model Context Protocol.</li>
              <li>Paste the server URL, choose OAuth 2.0 → Manual, and fill in the fields below.</li>
              <li>Save, then copy the callback (redirect) URL Copilot Studio shows and add it here before connecting.</li>
            </ol>
            <div className="space-y-4">
              {setup.serverUrl && <CopyField label="Server URL" value={setup.serverUrl} />}
              <CopyField label="Client ID" value={client.clientId} />
              <div className="space-y-1">
                <p className="text-sm font-medium">Client secret</p>
                <p className="text-sm text-muted-foreground">
                  Shown only when created
                  {client.secretRotatedAt ? ` or regenerated (last ${dateFormat.format(client.secretRotatedAt)})` : ""}. Lost
                  it? Regenerate it, then update every connector that uses it.
                </p>
              </div>
              {setup.authorizationUrl && <CopyField label="Authorization URL" value={setup.authorizationUrl} />}
              {setup.tokenUrl && <CopyField label="Token URL and refresh URL" value={setup.tokenUrl} />}
              <CopyField label="Scopes" value={setup.scopes} />
            </div>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Callback URLs</h3>
              <p className="text-xs text-muted-foreground">Each Copilot Studio connector has its own. Sign-in fails until it&rsquo;s added here.</p>
              {client.callbackUrls.length > 0 && (
                <ul className="space-y-1">
                  {client.callbackUrls.map((url) => (
                    <li key={url} className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-3 py-1.5 font-mono text-xs">{url}</code>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remove callback URL"
                        disabled={busy}
                        onClick={() => run(() => removeCallback({ url }), "Callback URL removed.")}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <form
                className="flex gap-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!callback.trim()) return;
                  const added = await run(() => addCallback({ url: callback }), "Callback URL added.");
                  if (added.ok) setCallback("");
                }}
              >
                <Input
                  value={callback}
                  onChange={(event) => setCallback(event.target.value)}
                  placeholder="https://global.consent.azure-apim.net/redirect/…"
                  aria-label="Callback URL"
                />
                <Button type="submit" variant="outline" disabled={busy || !callback.trim()}>
                  Add
                </Button>
              </form>
            </section>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy} onClick={() => setConfirm("regenerate")}>
                Regenerate secret
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setConfirm("delete")}>
                Delete credentials
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Created{client.createdByName ? ` by ${client.createdByName}` : ""} on {dateFormat.format(client.createdAt)}.
            </p>
          </>
        )}
      </CardContent>

      <Dialog open={secret !== null} onOpenChange={(open) => !open && setSecret(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy these into Copilot Studio now</DialogTitle>
            <DialogDescription>
              They&rsquo;re the first fields Copilot Studio asks for. The secret isn&rsquo;t shown again: Fabric doesn&rsquo;t
              keep it. The rest of the setup is on the card once you close this.
            </DialogDescription>
          </DialogHeader>
          {secret && (
            <div className="space-y-4">
              {setup.serverUrl && <CopyField label="Server URL" value={setup.serverUrl} />}
              <CopyField label="Client ID" value={secret.clientId} />
              <CopyField label="Client secret" value={secret.clientSecret} />
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setSecret(null)}>I&rsquo;ve copied it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirm === "regenerate"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Regenerate the client secret?"
        description="The current secret stops working at once. Every Copilot Studio connector using it needs the new one."
        confirmLabel="Regenerate"
        destructive
        onConfirm={async () => {
          const rotated = await run(() => regenerate({}));
          if (rotated.ok) setSecret(rotated.value);
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
          await run(() => remove({}), "Copilot Studio credentials deleted.");
        }}
      />
    </Card>
  );
}
