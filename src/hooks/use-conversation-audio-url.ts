"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export function useConversationAudioUrl(
  clerkOrgId: string | null | undefined,
  conversationId: Id<"conversations">,
): string | null {
  const token = useQuery(api.postCall.getAudioPlaybackToken, { conversationId });
  if (!clerkOrgId || !token) return null;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
  const siteUrl = convexUrl.replace(".cloud", ".site");
  return `${siteUrl}/audio/${clerkOrgId}/${conversationId}?exp=${token.exp}&sig=${token.sig}`;
}
