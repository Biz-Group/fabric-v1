"use client";

import { usePaginatedQuery, useQuery } from "convex/react";
import { MessageSquareText, Sparkles, ThumbsDown, ThumbsUp, Users } from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle } from "@/components/ui/page-title";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/features/admin/stat-card";
import { formatRelativeTime } from "@/features/home/home-view-model";

const UNAVAILABLE_REASON = {
  switchOff: "AskFabric isn't switched on for this workspace.",
  missingConfig: "AskFabric isn't configured on this deployment yet.",
  invalidConfig: "AskFabric's configuration on this deployment is invalid.",
} as const;

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function Heading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function FeedbackTable() {
  const { results, status, loadMore } = usePaginatedQuery(api.askUsage.listFeedback, {}, { initialNumItems: 25 });
  if (status === "LoadingFirstPage") return <Skeleton className="h-32 w-full" />;
  if (results.length === 0) {
    return (
      <EmptyState
        icon={ThumbsUp}
        title="No feedback yet"
        description="Ratings appear here when people mark an AskFabric answer helpful or not."
      />
    );
  }
  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Rating</TableHead>
            <TableHead>Shared with Fabric</TableHead>
            <TableHead className="text-right">Rated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((row) => (
            <TableRow key={row._id}>
              <TableCell className="max-w-0 truncate">{row.member}</TableCell>
              <TableCell>
                {row.rating === "up" ? (
                  <span className="inline-flex items-center gap-1.5">
                    <ThumbsUp className="size-3.5 text-muted-foreground" aria-hidden />
                    Helpful
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <ThumbsDown className="size-3.5 text-muted-foreground" aria-hidden />
                    Not helpful
                  </span>
                )}
              </TableCell>
              <TableCell>{row.shared ? <Badge variant="secondary">Shared</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className="text-right text-muted-foreground">{formatRelativeTime(row.ratedAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {status === "CanLoadMore" && (
        <Button variant="ghost" size="sm" onClick={() => loadMore(25)}>
          Load more
        </Button>
      )}
    </div>
  );
}

/**
 * Admin → AskFabric (FR-8.3, D39, D50): how the workspace uses AskFabric and
 * how answers are rated. No questions, answers or thread titles (D12), and no
 * cost (D50).
 */
export default function AdminAskFabricPage() {
  const availability = useQuery(api.ask.getAvailability);
  const usage = useQuery(api.askUsage.getOrgUsage);

  return (
    <div className="space-y-6">
      <div>
        <PageTitle render={<h2 />}>AskFabric</PageTitle>
        <p className="text-sm text-muted-foreground">
          Activity and feedback over the last 30 days. Questions and answers stay private to the people who asked them.
        </p>
      </div>

      {availability && !availability.available && availability.reason && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {UNAVAILABLE_REASON[availability.reason]}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Questions"
          value={usage?.last30Days.questions}
          hint={usage ? `${usage.last7Days.questions} in the last 7 days` : undefined}
          icon={MessageSquareText}
        />
        <StatCard
          label="Active users"
          value={usage?.last30Days.activeUsers}
          hint={usage ? `${usage.last30Days.threads} threads` : undefined}
          icon={Users}
        />
        <StatCard
          label="Rated helpful"
          value={usage?.thumbsUp}
          hint={usage ? `${usage.thumbsDown} not helpful` : undefined}
          icon={ThumbsUp}
        />
        <StatCard
          label="Errors"
          value={usage ? percent(usage.errorRate) : undefined}
          hint={usage ? `${percent(usage.stopRate)} stopped by the asker` : undefined}
          icon={Sparkles}
          tone={usage && usage.errorRate > 0.1 ? "destructive" : "default"}
        />
      </div>

      <section className="space-y-3">
        <Heading title="Members" description="Questions and ratings per member, last 30 days." />
        {usage === undefined ? (
          <Skeleton className="h-24 w-full" />
        ) : usage.members.length === 0 ? (
          <EmptyState icon={Users} title="No questions yet" description="Members appear here once they ask AskFabric something." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead className="text-right">Questions</TableHead>
                <TableHead className="text-right">Helpful</TableHead>
                <TableHead className="text-right">Not helpful</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.members.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell className="max-w-0 truncate">{member.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{member.questions}</TableCell>
                  <TableCell className="text-right tabular-nums">{member.thumbsUp}</TableCell>
                  <TableCell className="text-right tabular-nums">{member.thumbsDown}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {usage?.capped && <p className="text-xs text-muted-foreground">Counts cover the most recent activity only.</p>}
      </section>

      <section className="space-y-3">
        <Heading title="Feedback" description="Every rating, newest first. Shared answers go to the Fabric team, not to admins." />
        <FeedbackTable />
      </section>
    </div>
  );
}
