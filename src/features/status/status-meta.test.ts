import { describe, expect, it } from "vitest";
import schema from "../../../convex/schema";
import { PENDING_WORK_LABELS } from "../../../convex/readModelHelpers";
import { OVERVIEW_STATE_META } from "@/features/overview/overview-view-model";
import {
  automationPotentialTone,
  confidenceTone,
  conversationStatusMeta,
  overviewRowStatus,
  overviewStateMeta,
  processPendingStatusMeta,
  processRowStatus,
  STATUS_TONE_CHIP,
  STATUS_TONE_SURFACE,
  STATUS_TONE_TEXT,
  type StatusMeta,
  type StatusTone,
} from "./status-meta";

const TONES: StatusTone[] = [
  "success",
  "warning",
  "info",
  "destructive",
  "neutral",
];

// Read from the schema, so a status added there fails here until it has meta.
const conversationStatuses =
  schema.tables.conversations.validator.fields.status.members.map(
    (member) => member.value,
  );
const pendingWorkStatuses = Object.keys(PENDING_WORK_LABELS);

function expectComplete(meta: StatusMeta) {
  expect(meta.label.trim()).not.toBe("");
  expect(TONES).toContain(meta.tone);
  expect(meta.icon).toBeTruthy();
}

describe("status meta", () => {
  it("covers every conversation status with a label, tone and icon", () => {
    expect(Object.keys(conversationStatusMeta).sort()).toEqual(
      [...conversationStatuses].sort(),
    );
    for (const status of conversationStatuses) {
      expectComplete(conversationStatusMeta[status]);
    }
  });

  it("covers every process pending-work status", () => {
    expect(Object.keys(processPendingStatusMeta).sort()).toEqual(
      [...pendingWorkStatuses].sort(),
    );
    for (const meta of Object.values(processPendingStatusMeta)) {
      expectComplete(meta);
    }
  });

  it("covers every overview state", () => {
    expect(Object.keys(overviewStateMeta)).toEqual(
      Object.keys(OVERVIEW_STATE_META),
    );
    for (const meta of Object.values(overviewStateMeta)) {
      expectComplete(meta);
    }
    // In progress reads the same whether it's a contribution or an overview.
    expect(overviewStateMeta.refreshing.tone).toBe(
      conversationStatusMeta.processing.tone,
    );
  });

  it("gives each conversation status its own name and colour", () => {
    const metas = Object.values(conversationStatusMeta);
    expect(new Set(metas.map((meta) => meta.label)).size).toBe(metas.length);
    expect(new Set(metas.map((meta) => meta.tone)).size).toBe(metas.length);
  });

  it("shows a process the same way as the contribution behind it", () => {
    expect(processPendingStatusMeta.needs_labels).toBe(
      conversationStatusMeta.needs_speaker_labels,
    );
    expect(processPendingStatusMeta.processing).toBe(
      conversationStatusMeta.processing,
    );
    expect(processPendingStatusMeta.failed).toBe(conversationStatusMeta.failed);
  });

  it("keeps waiting-on-a-person apart from in-progress", () => {
    expect(conversationStatusMeta.needs_speaker_labels.tone).toBe("warning");
    expect(conversationStatusMeta.processing.tone).toBe("info");
    expect(conversationStatusMeta.processing.busy).toBe(true);
  });

  it("flags rows only when they need something", () => {
    expect(processRowStatus("current")).toBeNull();
    expect(processRowStatus("needs_labels")).toBe(
      conversationStatusMeta.needs_speaker_labels,
    );
    expect(overviewRowStatus("stale")?.tone).toBe("warning");
    expect(overviewRowStatus("failed")?.tone).toBe("destructive");
    for (const quiet of ["missing", "current", "refreshing", "partial"] as const) {
      expect(overviewRowStatus(quiet)).toBeNull();
    }
  });

  it("never uses one icon for two tones, so an icon alone still reads", () => {
    const toneByIcon = new Map<unknown, StatusTone>();
    for (const meta of [
      ...Object.values(conversationStatusMeta),
      ...Object.values(processPendingStatusMeta),
      ...Object.values(overviewStateMeta),
    ]) {
      const seen = toneByIcon.get(meta.icon);
      if (seen) expect(seen).toBe(meta.tone);
      toneByIcon.set(meta.icon, meta.tone);
    }
  });

  it("maps every tone to classes", () => {
    for (const tone of TONES) {
      expect(STATUS_TONE_TEXT[tone]).toMatch(/^text-/);
      expect(STATUS_TONE_SURFACE[tone]).toMatch(/^border-/);
      expect(STATUS_TONE_CHIP[tone]).toContain(STATUS_TONE_TEXT[tone]);
    }
  });

  it("only flags low confidence, and never flags low automation potential", () => {
    expect(confidenceTone.low).toBe("warning");
    expect(confidenceTone.medium).toBe("neutral");
    expect(automationPotentialTone.low).toBe("neutral");
    expect(automationPotentialTone.high).toBe(confidenceTone.high);
  });
});
