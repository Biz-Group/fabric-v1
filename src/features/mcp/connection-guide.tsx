"use client";

import { Bot, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MenuPath, OpenAppLink, Step, StepHint, Steps, ValueRow, Values } from "@/features/mcp/setup-steps";

/** Claude's own connector settings (support.claude.com, "Getting started with custom connectors"). */
export const CLAUDE_CONNECTORS_URL = "https://claude.ai/customize/connectors";
const EXAMPLE_QUESTION = "Using Fabric, where do our processes break down most often?";

/**
 * Connecting Claude, for any member. One URL per workspace (M13). Shared by
 * the member page and Admin → MCP, so the steps read the same in both places.
 */
export function ClaudeSteps({ workspaceUrl, intro }: { workspaceUrl: string | null; intro?: ReactNode }) {
  return (
    <div className="space-y-5">
      <GuideHeader intro={intro ?? "Each member connects for themselves. It takes a minute."}>
        <OpenAppLink href={CLAUDE_CONNECTORS_URL}>Open Claude</OpenAppLink>
      </GuideHeader>
      <Steps>
        <Step n={1} title="Copy your workspace's connection URL">
          {workspaceUrl ? (
            <Values>
              <ValueRow label="Connection URL" value={workspaceUrl} />
            </Values>
          ) : (
            <StepHint>This workspace has no connection URL yet. Contact Fabric support.</StepHint>
          )}
          <StepHint>It connects to this workspace only. In several workspaces? Add one connector for each.</StepHint>
        </Step>
        <Step n={2} title="Add it to Claude as a custom connector">
          <MenuPath label="In Claude:" items={["Customize", "Connectors", "+ Add", "Add custom connector"]} />
          <StepHint>
            Name it <span className="font-medium text-foreground">Fabric</span>, paste the URL, then follow the prompts and
            select Add. On Claude Team or Enterprise, an owner may need to add it under Organization settings first; you then
            select Connect next to it.
          </StepHint>
        </Step>
        <Step n={3} title="Sign in with your Fabric account">
          <StepHint>Claude opens Fabric&rsquo;s sign-in page. Use the account you use for this workspace.</StepHint>
        </Step>
        <Step n={4} title="Ask about your organisation">
          <MenuPath label="In a chat:" items={["+", "Connectors", "Fabric on"]} />
          <StepHint>Then try:</StepHint>
          <Values>
            <ValueRow label="Example question" value={EXAMPLE_QUESTION} />
          </Values>
        </Step>
      </Steps>
    </div>
  );
}

/** One line of context for a guide, with an "Open …" link on the right. */
export function GuideHeader({ intro, children }: { intro: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{intro}</p>
      {children}
    </div>
  );
}

/** What the assistant can see, said once under each guide. */
export function AccessNote() {
  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground">
      <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />
      The assistant sees only what you can see in Fabric, and can&rsquo;t change anything. Signed in but refused? AI assistant
      access is off for this workspace: ask your Fabric admin.
    </p>
  );
}

/** Help → Connect AI assistants (B6): the member's guide, one tab per assistant. */
export function ConnectionGuide({
  workspaceUrl,
  isAdmin,
  adminMcpHref,
}: {
  workspaceUrl: string | null;
  isAdmin: boolean;
  adminMcpHref: string;
}) {
  return (
    <div className="space-y-5">
      <Tabs defaultValue="claude" className="gap-5">
        <TabsList>
          <TabsTrigger value="claude">Claude</TabsTrigger>
          <TabsTrigger value="copilot">Microsoft Copilot Studio</TabsTrigger>
        </TabsList>
        <TabsContent value="claude">
          <ClaudeSteps workspaceUrl={workspaceUrl} />
        </TabsContent>
        <TabsContent value="copilot">
          <div className="flex items-start gap-3 rounded-md border p-4">
            <Bot className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Set up once per agent, by an agent maker</p>
                <p className="text-sm text-muted-foreground">
                  A Copilot Studio agent maker adds Fabric as a tool, using credentials from a Fabric admin. The first time
                  the agent uses Fabric, it asks you to sign in with your Fabric account.
                </p>
              </div>
              {isAdmin && (
                <Link href={adminMcpHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Set it up in Admin → MCP
                </Link>
              )}
              <p className="text-xs text-muted-foreground">Microsoft 365 Copilot in Teams and Office is coming later.</p>
            </div>
          </div>
        </TabsContent>
      </Tabs>
      <AccessNote />
    </div>
  );
}
