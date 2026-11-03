"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingScreen } from "@/components/ui/loading-screen";
import { PageTitle } from "@/components/ui/page-title";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { describeError } from "@/lib/user-error-message";

type Exchange = NonNullable<FunctionReturnType<typeof api.askShared.viewSharedExchange>>;

function date(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

function ExchangeDialog({ exchange, onClose }: { exchange: Exchange | null; onClose: () => void }) {
  return (
    <Dialog open={exchange !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        {exchange && (
          <>
            <DialogHeader>
              <DialogTitle>Shared answer</DialogTitle>
              <DialogDescription>
                Shared {date(exchange.sharedAt)}, deleted {date(exchange.expiresAt)}. This view was recorded in the audit log.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              {exchange.note && (
                <Section title="Note from the user">
                  <p className="whitespace-pre-wrap">{exchange.note}</p>
                </Section>
              )}
              <Section title="Question">
                <p className="whitespace-pre-wrap">{exchange.question}</p>
              </Section>
              <Section title="Answer">
                <p className="whitespace-pre-wrap text-foreground/90">{exchange.answer.replace(/\[\[cite:(\d+)\]\]/g, "[$1]")}</p>
              </Section>
              {exchange.reasoning.length > 0 && (
                <Section title="Reasoning summaries">
                  <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                    {exchange.reasoning.map((text, i) => (
                      <li key={i}>{text}</li>
                    ))}
                  </ul>
                </Section>
              )}
              <Section title={`Tool calls · ${exchange.toolCalls.length}`}>
                <ul className="space-y-0.5 font-mono text-xs">
                  {exchange.toolCalls.map((call, i) => (
                    <li key={i}>
                      {call.name} — {call.input} — {call.found ? `found, ${call.resultTokens} tokens` : "not found"}
                    </li>
                  ))}
                </ul>
              </Section>
              <Section title={`Citations · ${exchange.citations.length}`}>
                <ol className="list-decimal space-y-1.5 pl-5">
                  {exchange.citations.map((citation, i) => (
                    <li key={i}>
                      <span className="font-medium">{citation.title}</span>{" "}
                      <span className="font-mono text-xs text-muted-foreground">{citation.source}</span>
                      {citation.citedText ? (
                        <p className="mt-0.5 border-l-2 pl-2 text-xs text-muted-foreground">{citation.citedText}</p>
                      ) : (
                        <p className="mt-0.5 text-xs text-muted-foreground">Cited text cleared (source deleted).</p>
                      )}
                    </li>
                  ))}
                </ol>
              </Section>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * AskFabric answers users shared after a thumbs-down (FR-7.3). Super admins
 * only; opening one writes an audit row. Kept 90 days (FR-7.4).
 */
export default function SharedExchangesPage() {
  const rows = useQuery(api.askShared.listSharedExchanges);
  const view = useMutation(api.askShared.viewSharedExchange);
  const [open, setOpen] = useState<Exchange | null>(null);
  const [pending, setPending] = useState<Id<"askSharedExchanges"> | null>(null);

  if (rows === undefined) return <LoadingScreen message="Loading shared answers…" />;

  return (
    <div className="space-y-6">
      <div>
        <PageTitle>Shared answers</PageTitle>
        <p className="text-sm text-muted-foreground">
          AskFabric answers users marked unhelpful and chose to share. Opening one is recorded in the audit log.
        </p>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Nothing shared" description="Answers appear here when a user shares a thumbs-down with the Fabric team." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Workspace</TableHead>
              <TableHead>Shared</TableHead>
              <TableHead className="text-right">Citations</TableHead>
              <TableHead className="text-right">Tool calls</TableHead>
              <TableHead>Note</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row._id}>
                <TableCell>{row.tenantName}</TableCell>
                <TableCell>{date(row.sharedAt)}</TableCell>
                <TableCell className="text-right tabular-nums">{row.citations}</TableCell>
                <TableCell className="text-right tabular-nums">{row.toolCalls}</TableCell>
                <TableCell>{row.hasNote ? "Yes" : "—"}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending === row._id}
                    onClick={async () => {
                      setPending(row._id);
                      try {
                        const exchange = await view({ exchangeId: row._id });
                        if (exchange) setOpen(exchange);
                      } catch (error) {
                        toast.error(describeError(error, "Couldn't open the shared answer."));
                      } finally {
                        setPending(null);
                      }
                    }}
                  >
                    Open
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <ExchangeDialog exchange={open} onClose={() => setOpen(null)} />
    </div>
  );
}
