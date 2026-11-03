"use client";

import { useMutation, useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ui/conversation";
import { Message, MessageContent } from "@/components/ui/message";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/lib/user-error-message";
import { AskAnswer, AskSources, HelpDialogHost } from "./ask-citations";
import { AskComposer, type Mention } from "./ask-composer";
import { AskFeedback } from "./ask-feedback";
import { AskStatusLine, AskThoughtTrace } from "./ask-thought-trace";
import { answerText, errorMessage, type MessageStatus } from "./trace-view-model";

type Thread = NonNullable<FunctionReturnType<typeof api.ask.getThread>>;
type ThreadMessage = Thread["messages"][number];

/**
 * Shown only until the first stored set exists (FR-6.3): the org-wide seed
 * questions, so the empty state never waits on a query.
 */
const DEFAULT_PROMPTS = [
  "What are the things that are consistently slowing us down or creating friction in the business?",
  "What would be the three most impactful moves we could make?",
  "Which systems cause the most friction, and which should we think about replacing?",
  "How much duplicated work is there across our processes?",
];

function AssistantMessage({
  message,
  onRetry,
  onOpenHelp,
}: {
  message: ThreadMessage;
  onRetry: (() => void) | null;
  onOpenHelp: (articleId: string) => void;
}) {
  const status = message.status as MessageStatus;
  const text = answerText(message.parts);
  return (
    <Message from="assistant" className="py-3">
      <MessageContent variant="flat" className="w-full max-w-none gap-0 overflow-visible">
        <AskThoughtTrace parts={message.parts} status={status} completedAt={message.completedAt} />
        {status === "streaming" && <AskStatusLine parts={message.parts} status={status} />}
        {text && <AskAnswer text={text} citations={message.citations} onOpenHelp={onOpenHelp} />}
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
        {text && status !== "streaming" && <AskFeedback messageId={message._id} feedback={message.feedback} />}
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
 * One thread: its questions, answers and the composer (FR-2, FR-4.6). Takes a
 * thread id and callbacks only, so it can later sit in a side panel. With no
 * thread it shows the starter prompts and creates one on the first question.
 */
export function AskConversation({
  threadId,
  onThreadCreated,
}: {
  threadId: Id<"askThreads"> | null;
  onThreadCreated: (threadId: Id<"askThreads">) => void;
}) {
  const thread = useQuery(api.ask.getThread, threadId ? { threadId } : "skip");
  const stored = useQuery(api.askSuggestions.getSuggestions, threadId ? "skip" : {});
  const prompts = stored && stored.length > 0 ? stored.map((s) => s.text) : DEFAULT_PROMPTS;
  const sendMessage = useMutation(api.ask.sendMessage);
  const stopTurn = useMutation(api.ask.stopTurn);

  const messages = thread?.messages ?? [];
  const streaming = messages.find((m) => m.role === "assistant" && m.status === "streaming");

  const send = async (text: string, mentions: Mention[] = []): Promise<boolean> => {
    try {
      const result = await sendMessage({
        ...(threadId ? { threadId } : {}),
        text,
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
              <div className="space-y-1 text-center">
                <h2 className="text-lg font-semibold text-foreground">Ask about how your organization works</h2>
                <p className="text-sm text-muted-foreground">
                  Answers come from your workspace&apos;s contributions, overviews and flows, with sources.
                </p>
              </div>
              <ul className="grid w-full max-w-2xl gap-2 sm:grid-cols-2">
                {prompts.map((prompt) => (
                  <li key={prompt}>
                    <button
                      type="button"
                      className="h-full w-full rounded-lg border bg-background p-3 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                      onClick={() => void send(prompt)}
                    >
                      {prompt}
                    </button>
                  </li>
                ))}
              </ul>
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
              <ConversationScrollButton />
            </Conversation>
          )}
          <div className="mx-auto w-full max-w-3xl px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <AskComposer streaming={streaming !== undefined} onSend={send} onStop={stop} autoFocus={!threadId} />
            <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
              AskFabric answers from your workspace&apos;s data and can be wrong. Check the sources.
            </p>
          </div>
        </div>
      )}
    </HelpDialogHost>
  );
}
