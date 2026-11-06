"use client";

import { useMutation, useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowRightLeft,
  AtSign,
  BookOpen,
  ChartPie,
  Copy,
  CornerDownRight,
  Hourglass,
  Puzzle,
  RotateCcw,
  Server,
  Sparkles,
  Target,
  UserRound,
  Workflow,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { SuggestionTopic } from "../../../convex/askfabric/suggestions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Conversation, ConversationContent } from "@/components/ui/conversation";
import { Message, MessageContent } from "@/components/ui/message";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/lib/user-error-message";
import { AskAnswer, AskEvidence, AskSources, HelpDialogHost } from "./ask-citations";
import { AskComposer, type AskComposerHandle, type Mention } from "./ask-composer";
import type { AskContextRef } from "./ask-context";
import { AskThinkingMark } from "./ask-thinking-mark";
import { CopyAnswerButton, ReadAloudButton } from "./ask-answer-actions";
import { AskFeedback } from "./ask-feedback";
import { AskStatusLine, AskThoughtTrace } from "./ask-thought-trace";
import { AskDisplays, type ChoiceContext } from "./display/ask-display";
import { answerText, chosenOption, displayParts, errorMessage, type MessageStatus } from "./trace-view-model";

type Thread = NonNullable<FunctionReturnType<typeof api.ask.getThread>>;
type ThreadMessage = Thread["messages"][number];

type StarterPrompt = { text: string; topic?: SuggestionTopic };

/**
 * Shown only until the first stored set exists (FR-6.3): the org-wide seed
 * questions, so the empty state never waits on a query.
 */
const DEFAULT_PROMPTS: StarterPrompt[] = [
  {
    text: "What are the things that are consistently slowing us down or creating friction in the business?",
    topic: "friction",
  },
  { text: "What would be the three most impactful moves we could make?", topic: "biggestMoves" },
  { text: "Which systems cause the most friction, and which should we think about replacing?", topic: "systems" },
  { text: "How much duplicated work is there across our processes?", topic: "duplication" },
];

/** Each starter prompt's label on the new-thread page. */
const TOPIC: Record<SuggestionTopic, { label: string; icon: LucideIcon }> = {
  friction: { label: "Friction", icon: Zap },
  biggestMoves: { label: "Biggest moves", icon: Target },
  systems: { label: "Systems", icon: Server },
  duplication: { label: "Duplication", icon: Copy },
  bottlenecks: { label: "Bottlenecks", icon: Hourglass },
  handoffs: { label: "Handoffs", icon: ArrowRightLeft },
  keyPersonRisk: { label: "Key-person risk", icon: UserRound },
  gaps: { label: "Gaps", icon: Puzzle },
  whatsNew: { label: "What's new", icon: Sparkles },
  coverage: { label: "Coverage", icon: ChartPie },
  usingFabric: { label: "Using Fabric", icon: BookOpen },
  howItWorks: { label: "How it works", icon: Workflow },
};

const KIND_LABEL = { function: "function", department: "department", process: "process" } as const;

function plural(count: number, one: string, many: string, capped = false): string {
  return `${count.toLocaleString()}${capped ? "+" : ""} ${count === 1 && !capped ? one : many}`;
}

/** What answers can draw on, or null before the workspace has contributions. */
function trustLine(stats: FunctionReturnType<typeof api.askSuggestions.getStarterContext>["stats"]): string | null {
  if (!stats || stats.contributions === 0) return null;
  const parts = [
    plural(stats.contributions, "contribution", "contributions", stats.contributionsCapped),
    ...(stats.processes > 0 ? [plural(stats.processes, "process", "processes")] : []),
    ...(stats.departments > 0 ? [plural(stats.departments, "department", "departments")] : []),
  ];
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return `Answers draw on ${list} in this workspace, with a source for every claim.`;
}

function AssistantMessage({
  message,
  isLatest,
  choice,
  onAsk,
  onRetry,
  onOpenHelp,
}: {
  message: ThreadMessage;
  isLatest: boolean;
  choice: ChoiceContext;
  onAsk: (question: string) => void;
  onRetry: (() => void) | null;
  onOpenHelp: (articleId: string) => void;
}) {
  const status = message.status as MessageStatus;
  const text = answerText(message.parts);
  return (
    <Message from="assistant" className="py-3">
      <MessageContent variant="flat" className="w-full max-w-none gap-0 overflow-visible">
        <AskThoughtTrace parts={message.parts} status={status} completedAt={message.completedAt} />
        {status === "streaming" && <AskStatusLine parts={message.parts} status={status} startedAt={message._creationTime} />}
        {text && status !== "streaming" && <AskEvidence citations={message.citations} />}
        {text && <AskAnswer text={text} citations={message.citations} onOpenHelp={onOpenHelp} />}
        {/* Components follow the text they illustrate (D56); copy and read aloud skip them. */}
        {text && <AskDisplays parts={displayParts(message.parts)} choice={choice} answeredAt={message.completedAt ?? message._creationTime} />}
        {status === "stopped" && <p className="mt-2 text-xs text-muted-foreground">Stopped.</p>}
        {status === "error" && (
          <div
            role="alert"
            className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
          >
            <span className="text-foreground">{errorMessage(message.errorReason)}</span>
            {onRetry && message.errorReason !== "accessLost" && message.errorReason !== "refusal" && (
              <Button size="xs" variant="outline" onClick={onRetry}>
                <RotateCcw className="size-3" aria-hidden />
                Retry
              </Button>
            )}
          </div>
        )}
        {text && status !== "streaming" && <AskSources citations={message.citations} onOpenHelp={onOpenHelp} />}
        {text && status !== "streaming" && (
          <AskFeedback
            messageId={message._id}
            feedback={message.feedback}
            actions={
              <>
                <CopyAnswerButton text={text} citations={message.citations} />
                <ReadAloudButton messageId={message._id} />
              </>
            }
          />
        )}
        {/* Only under the latest answer; one click asks it. Right-aligned, on
            the side the member's own questions sit. */}
        {/* Not while a picker waits for a choice: the picker is the next step. */}
        {isLatest &&
          status === "complete" &&
          !displayParts(message.parts).some((part) => part.display === "choices") &&
          message.followUps &&
          message.followUps.length > 0 && (
          <div role="group" aria-label="Suggested follow-up questions" className="mt-3 flex flex-col items-end gap-2">
            {message.followUps.map((question) => (
              <button
                key={question}
                type="button"
                className="focus-ring inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-org-accent-border bg-org-accent-subtle px-3 py-1 text-left text-xs font-medium text-org-accent-selected-foreground transition-colors hover:bg-org-accent-selected"
                onClick={() => onAsk(question)}
              >
                <CornerDownRight className="size-3.5 shrink-0 text-org-accent" aria-hidden />
                {question}
              </button>
            ))}
          </div>
        )}
      </MessageContent>
    </Message>
  );
}

/** A mention as the reference the server takes: kind and id, never the name (FR-4.2). */
function toRef(mention: Mention) {
  switch (mention.kind) {
    case "function":
      return { kind: mention.kind, id: mention.id };
    case "department":
      return { kind: mention.kind, id: mention.id };
    case "process":
      return { kind: mention.kind, id: mention.id };
  }
}

function questionText(message: ThreadMessage): string {
  return answerText(message.parts);
}

/**
 * The footer line: why asking is blocked once the beta's daily limit is used
 * (D51), otherwise the standing reminder to check sources. The count of
 * questions left sits in the page header.
 */
function allowanceNote(allowance: FunctionReturnType<typeof api.ask.getDailyAllowance> | undefined): string {
  const reminder = "AskFabric is in beta and can be wrong. Check the sources.";
  if (!allowance) return reminder;
  if (allowance.orgLimitReached) {
    return "Your workspace has used today's AskFabric beta questions. You can ask again after midnight Gulf time.";
  }
  if (allowance.remaining === 0) {
    return `You've used today's ${allowance.limit} beta questions. You can ask again after midnight Gulf time.`;
  }
  return reminder;
}

/**
 * Jumps to the latest message. It sits at the pane's right edge over a fade,
 * clear of the centred answer column, so it never covers the text.
 */
function AskScrollButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  if (isAtBottom) return null;
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background" aria-hidden />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="absolute right-4 bottom-3 rounded-full bg-background text-muted-foreground shadow-md dark:bg-background"
        onClick={() => void scrollToBottom()}
      >
        <ArrowDown className="size-3.5" aria-hidden />
        Latest
      </Button>
    </>
  );
}

/**
 * One thread: its questions, answers and the composer (FR-2, FR-4.6). Takes a
 * thread id and callbacks only, so it can later sit in a side panel. With no
 * thread it shows the starter prompts and creates one on the first question.
 */
export function AskConversation({
  threadId,
  context = null,
  prefill,
  onClearContext,
  onThreadCreated,
}: {
  threadId: Id<"askThreads"> | null;
  /** The page a new thread starts from ("Ask about this", 2B.1). */
  context?: AskContextRef | null;
  /** A question to put in the composer, unsent (Cmd+K, 2B.2). */
  prefill?: string;
  onClearContext?: () => void;
  onThreadCreated: (threadId: Id<"askThreads">) => void;
}) {
  const thread = useQuery(api.ask.getThread, threadId ? { threadId } : "skip");
  // Checked as the viewer: an unreadable or crafted context comes back null
  // and the page acts as if there were none.
  const about = useQuery(api.askSuggestions.getEntityStarters, !threadId && context ? { ref: context } : "skip");
  const stored = useQuery(api.askSuggestions.getSuggestions, threadId || about ? "skip" : {});
  // Null while loading, so the defaults never flash before the member's own
  // prompts; the defaults are only for a member with none stored yet.
  const prompts: StarterPrompt[] | null = about
    ? about.prompts
    : (context && about === undefined) || stored === undefined
      ? null
      : stored.length > 0
        ? stored
        : DEFAULT_PROMPTS;
  const starter = useQuery(api.askSuggestions.getStarterContext, threadId ? "skip" : {});
  const allowance = useQuery(api.ask.getDailyAllowance);
  const sendMessage = useMutation(api.ask.sendMessage);
  const stopTurn = useMutation(api.ask.stopTurn);
  const requestFollowUps = useMutation(api.ask.requestFollowUps);
  const composerRef = useRef<AskComposerHandle>(null);

  const messages = thread?.messages ?? [];
  const streaming = messages.find((m) => m.role === "assistant" && m.status === "streaming");

  // An answer from before follow-ups existed gets them when its thread opens;
  // the server ignores the request while a fresh answer's call is running.
  const latest = messages.at(-1);
  const missingFollowUpsId =
    latest?.role === "assistant" && latest.status === "complete" && latest.followUps === null ? latest._id : null;
  useEffect(() => {
    if (missingFollowUpsId) void requestFollowUps({ messageId: missingFollowUpsId }).catch(() => {});
  }, [missingFollowUpsId, requestFollowUps]);

  const trust = trustLine(starter?.stats ?? null);
  const areas: Mention[] = [
    ...(starter?.department ? [{ kind: "department" as const, ...starter.department }] : []),
    ...(starter?.function ? [{ kind: "function" as const, ...starter.function }] : []),
  ];

  const contextRef = !threadId && about ? toRef({ kind: about.kind, id: about.id, name: about.name } as Mention) : null;
  const send = async (text: string, mentions: Mention[] = []): Promise<boolean> => {
    try {
      const result = await sendMessage({
        ...(threadId ? { threadId } : {}),
        text,
        ...(contextRef ? { contextRef } : {}),
        ...(mentions.length ? { mentions: mentions.map(toRef) } : {}),
      });
      if (!threadId) onThreadCreated(result.threadId);
      return true;
    } catch (error) {
      toast.error(describeError(error, "Couldn't send your question. Try again."));
      return false;
    }
  };

  const stop = () => {
    if (!streaming) return;
    void stopTurn({ messageId: streaming._id }).catch((error) =>
      toast.error(describeError(error, "Couldn't stop the answer.")),
    );
  };

  if (threadId && thread === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        This thread no longer exists.
      </div>
    );
  }

  return (
    <HelpDialogHost>
      {(openHelp) => (
        <div className="flex min-h-0 flex-1 flex-col">
          {threadId && thread === undefined ? (
            <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
              <Skeleton className="ml-auto h-10 w-2/3" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : !threadId ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-4">
              <div className="flex flex-col items-center gap-2 text-center">
                <span className="mb-1 flex size-12 items-center justify-center rounded-xl border border-org-accent-border bg-org-accent-subtle">
                  <AskThinkingMark still className="size-6 text-org-accent" />
                </span>
                <h2 className="text-lg font-semibold text-balance text-foreground">
                  {about ? `Ask about ${about.name}` : "Ask about how your organization works"}
                  {/* Inline, so it wraps with the last word on a narrow screen. */}
                  <Badge variant="outline" className="ml-2 align-middle">
                    Beta
                  </Badge>
                </h2>
                <p className="max-w-lg text-sm text-muted-foreground">
                  {trust ?? "Answers come from your workspace's contributions, overviews and flows, with sources."}
                </p>
              </div>
              <ul className="grid w-full max-w-2xl gap-2 sm:grid-cols-2" aria-busy={prompts === null}>
                {prompts === null &&
                  Array.from({ length: context ? 3 : 4 }, (_, index) => (
                    <li key={index}>
                      <Skeleton className="h-20 w-full rounded-lg" />
                    </li>
                  ))}
                {prompts?.map((prompt) => {
                  const topic = prompt.topic ? TOPIC[prompt.topic] : null;
                  return (
                    <li key={prompt.text}>
                      <button
                        type="button"
                        className="flex h-full w-full flex-col gap-1.5 rounded-lg border bg-background p-3 text-left text-sm text-foreground transition-colors hover:border-org-accent-border hover:bg-org-accent-subtle focus-visible:outline-2 focus-visible:outline-ring"
                        onClick={() => void send(prompt.text)}
                      >
                        {topic && (
                          <span className="flex items-center gap-1.5 text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
                            <topic.icon className="size-3.5 text-org-accent" aria-hidden />
                            {topic.label}
                          </span>
                        )}
                        {prompt.text}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {areas.length > 0 && !about && (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <span className="text-xs text-muted-foreground">Or start from an area</span>
                  {areas.map((area) => (
                    <button
                      key={area.id}
                      type="button"
                      className="focus-ring inline-flex min-h-8 items-center gap-1.5 rounded-full border border-org-accent-border bg-org-accent-subtle px-3 py-1 text-xs font-medium text-org-accent-selected-foreground transition-colors hover:bg-org-accent-selected"
                      onClick={() => composerRef.current?.insertMention(area)}
                    >
                      <AtSign className="size-3.5 text-org-accent" aria-hidden />
                      {area.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <Conversation className="min-h-0">
              <ConversationContent className="mx-auto w-full max-w-3xl">
                {messages.map((message, index) =>
                  message.role === "user" ? (
                    <Message key={message._id} from="user" className="py-3">
                      <MessageContent className="whitespace-pre-wrap break-words">{questionText(message)}</MessageContent>
                    </Message>
                  ) : (
                    <AssistantMessage
                      key={message._id}
                      message={message}
                      isLatest={index === messages.length - 1}
                      choice={{
                        // A choice is the next question's mention (FR-11.4).
                        chosenId: chosenOption(message.parts, messages[index + 1]?.mentions ?? []),
                        active: index === messages.length - 1 && message.status === "complete" && !streaming,
                        // Asks the question again about the chosen entity: a new
                        // question, so it counts against the day's limit (D51).
                        onChoose: (option) =>
                          send(
                            `${index > 0 ? questionText(messages[index - 1]) : ""} (${option.name})`.trim(),
                            [option as Mention],
                          ),
                      }}
                      onAsk={(question) => void send(question)}
                      onOpenHelp={openHelp}
                      onRetry={
                        index > 0 && messages[index - 1].role === "user" && index === messages.length - 1
                          ? () => void send(questionText(messages[index - 1]))
                          : null
                      }
                    />
                  ),
                )}
              </ConversationContent>
              <AskScrollButton />
            </Conversation>
          )}
          <div className="mx-auto w-full max-w-3xl px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {about && !threadId && (
              <div className="mb-2 flex">
                <span className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-org-accent-border bg-org-accent-subtle py-0.5 pr-0.5 pl-3 text-xs text-org-accent-selected-foreground">
                  <span className="truncate">
                    Asking about the {KIND_LABEL[about.kind]} <span className="font-medium">{about.name}</span>
                  </span>
                  {onClearContext && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="rounded-full"
                      aria-label={`Stop asking about ${about.name}`}
                      onClick={onClearContext}
                    >
                      <X aria-hidden />
                    </Button>
                  )}
                </span>
              </div>
            )}
            <AskComposer
              ref={composerRef}
              streaming={streaming !== undefined}
              onSend={send}
              onStop={stop}
              autoFocus={!threadId}
              initialText={threadId ? undefined : prefill}
            />
            <p className="mt-1.5 text-center text-[11px] text-muted-foreground">{allowanceNote(allowance)}</p>
          </div>
        </div>
      )}
    </HelpDialogHost>
  );
}
