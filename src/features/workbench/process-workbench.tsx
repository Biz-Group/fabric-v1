"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  BarChart3,
  Bot,
  ChevronRight,
  Building2,
  Layers,
  Cog,
  FileText,
  House,
  Mic,
  Pencil,
  Trash2,
} from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProcessHeader } from "@/features/workbench/process-header";
import { ProcessAppShell } from "@/features/shell/process-app-shell";
import { useWorkspaceRoutes } from "@/features/shell/use-workspace-routes";
import { ProcessConversationsTab } from "@/features/conversations/conversations-tab";
import { ProcessFlowTab } from "@/features/process-flow/process-flow-tab";
import { ProcessInsightsTab } from "@/features/insights/process-insights-tab";
import { ProcessAutomationsTab } from "@/features/automations/process-automations-tab";
import {
  HierarchyOverview,
  HierarchyOverviewCompactPreview,
  type HierarchyChildSummary,
} from "@/features/overview/hierarchy-overview";
import {
  ProcessOverview,
  ProcessOverviewCompactPreview,
} from "@/features/overview/process-overview";
import {
  ProcessTreeNavigator,
  type ProcessTreeDepartment,
  type ProcessTreeFunction,
  type ProcessTreeProcess,
  type TreeReveal,
} from "@/features/hierarchy/process-tree-navigator";
import { Coachmark } from "@/components/ui/coachmark";
import type {
  GettingStartedActions,
  ProcessPath,
} from "@/features/onboarding/getting-started-card";
import {
  ExploreSheet,
  SHOW_ME_AROUND_EVENT,
  Walkthrough,
  type WalkthroughOutcome,
} from "@/features/onboarding/walkthrough";
import {
  shouldAutoStartWalkthrough,
  walkthroughSteps,
} from "@/features/onboarding/walkthrough-steps";
import { toast } from "sonner";
import {
  type SelectionParams,
  readSelectionParams,
  buildSelectionQuery,
  readConversationParam,
} from "@/features/workbench/use-selection-params";
import {
  applyHistoryMove,
  followUrlChange,
  planHistoryMove,
  startTrail,
} from "@/features/workbench/history-move";
import {
  BackBar,
  ColumnItem,
  ColumnHeader,
  ColumnList,
  EmptyState,
  LoadingSpinner,
  type ColumnItemAction,
} from "@/features/workbench/workbench-columns";
import {
  OverviewActions,
  OverviewHeader,
} from "@/features/workbench/overview-header";
import type { WorkbenchCrumb } from "@/features/workbench/workbench-breadcrumb";
import {
  RecordingModal,
  type RecordingMode,
} from "@/features/recording/recording-modal";
import {
  WorkspaceHome,
  type MyConversation,
} from "@/features/home/workspace-home";
import {
  interviewCountLabel,
  type HomeDepartmentEntry,
  type HomeProcessEntry,
} from "@/features/home/home-view-model";
import {
  overviewRowStatus,
  processPendingStatusMeta,
  processRowStatus,
  type StatusMeta,
} from "@/features/status/status-meta";
import {
  rememberRecentProcess,
  useRecentProcessIds,
} from "@/features/home/recent-processes";
import { CrudDialog } from "@/features/hierarchy/crud-dialog";
import {
  clampMobileLevel,
  deepestMobileLevel,
  type MobileLevel,
} from "@/features/workbench/mobile-level";
import { CommandPalette } from "@/features/hierarchy/command-palette";
import { useProcessPdfDownload } from "@/features/workbench/process-pdf/use-process-pdf-download";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { GitBranch } from "lucide-react";
import type { RevealPath } from "./reveal-path";

// --- Types ---

type MobilePreview =
  | { type: "function"; id: Id<"functions">; name: string }
  | { type: "department"; id: Id<"departments">; name: string }
  | { type: "process"; id: Id<"processes">; name: string }
  | null;

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

// --- Main Component ---

export function ProcessWorkbench() {
  // Current user role is sourced from their membership in the active org.
  const membership = useQuery(api.users.getMyMembership);
  const userRole = membership?.role ?? "viewer";
  const canEdit = userRole === "admin" || userRole === "contributor";
  const recentProcessIds = useRecentProcessIds(
    membership?.userId ?? null,
    membership?.orgId ?? null,
  );

  // URL <-> selection sync plumbing. Selection is mirrored into the query
  // string so the view is refresh-safe, shareable, and Back-traversable.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const routes = useWorkspaceRoutes();
  const isMobile = useIsMobile();
  // Seed once from the URL (the initializer runs on first render only); later
  // external URL changes (Back/Forward) are reconciled by the read effect below.
  const [initialSelection] = useState(() => readSelectionParams(searchParams));
  // Where the URL sits among the history entries this visit created, so moving
  // up can return to an earlier entry (see history-move.ts).
  const [initialTrail] = useState(() => startTrail(searchParams.toString()));
  const historyTrail = useRef(initialTrail);

  // Column collapse state

  // Selection state (seeded from the URL so deep links / refresh restore position)
  const [selectedFunctionId, setSelectedFunctionId] =
    useState<Id<"functions"> | null>(initialSelection.fn);
  const [selectedDepartmentId, setSelectedDepartmentId] =
    useState<Id<"departments"> | null>(initialSelection.dept);
  const [selectedProcessId, setSelectedProcessId] =
    useState<Id<"processes"> | null>(initialSelection.proc);

  // Recording modal state
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [recordingMode, setRecordingMode] = useState<RecordingMode>("agent");

  // Mobile navigation level
  const [mobileLevel, setMobileLevel] = useState<MobileLevel>(
    deepestMobileLevel(initialSelection),
  );
  // Deleting the open item, here or by another member, clears part of the
  // selection; step the phone back up to a screen the selection still fills.
  const clampedMobileLevel = clampMobileLevel(mobileLevel, {
    fn: selectedFunctionId,
    dept: selectedDepartmentId,
    proc: selectedProcessId,
  });
  if (clampedMobileLevel !== mobileLevel) setMobileLevel(clampedMobileLevel);

  const [mobilePreview, setMobilePreview] = useState<MobilePreview>(null);
  // Which half of the phone landing screen is showing. Session-only: it is
  // remembered while drilling in and back out, so the way back up returns to
  // whichever the user came from, and it resets to Home on reload.
  const [mobileHomeView, setMobileHomeView] = useState<"home" | "browse">(
    "home",
  );

  // Active detail tab (0 = Overview, 1 = Conversations, 2 = Process Flow,
  // 3 = Insights, 4 = Automations), seeded from the URL.
  const [detailTab, setDetailTab] = useState<number>(initialSelection.tab);
  const [flowNodeId, setFlowNodeId] = useState<string | null>(
    initialSelection.node,
  );
  const [labelingJumpKey, setLabelingJumpKey] = useState(0);
  // A `conv` link (Admin → Conversations) opens that contribution once.
  const [initialConversationId] = useState(() =>
    initialSelection.proc ? readConversationParam(searchParams) : null,
  );
  const [conversationFocusId, setConversationFocusId] =
    useState<Id<"conversations"> | null>(initialConversationId);
  const [conversationFocusJumpKey, setConversationFocusJumpKey] = useState(
    initialConversationId ? 1 : 0,
  );

  // Selected names for breadcrumbs / back buttons
  const [selectedFunctionName, setSelectedFunctionName] = useState("");
  const [selectedDepartmentName, setSelectedDepartmentName] = useState("");
  const [selectedProcessName, setSelectedProcessName] = useState("");

  // Process report PDF export (flow fetched + rendered on demand).
  const { download: downloadProcessPdf, isDownloading: isDownloadingPdf } =
    useProcessPdfDownload();

  // CRUD mutations/actions
  const createFunction = useMutation(api.functions.create);
  const updateFunction = useMutation(api.functions.update);
  const removeFunction = useMutation(api.functions.remove);
  const createDepartment = useAction(api.departments.create);
  const updateDepartment = useAction(api.departments.update);
  const removeDepartment = useMutation(api.departments.remove);
  const createProcess = useAction(api.processes.create);
  const updateProcess = useAction(api.processes.update);
  const removeProcess = useMutation(api.processes.remove);

  // CRUD dialog state
  const [crudOpen, setCrudOpen] = useState(false);
  const [crudMode, setCrudMode] = useState<"create" | "edit" | "delete">(
    "create",
  );
  const [crudEntity, setCrudEntity] = useState<
    "Function" | "Department" | "Process"
  >("Function");
  const [crudTargetName, setCrudTargetName] = useState("");
  const [crudTargetDescription, setCrudTargetDescription] = useState("");
  const [crudTargetId, setCrudTargetId] = useState<string | null>(null);
  const [crudCurrentLocationId, setCrudCurrentLocationId] = useState<
    string | null
  >(null);

  // Server-computed delete eligibility for the selected delete target.
  const deleteFnEligibility = useQuery(
    api.functions.deleteEligibility,
    crudOpen &&
      crudMode === "delete" &&
      crudEntity === "Function" &&
      crudTargetId
      ? { functionId: crudTargetId as Id<"functions"> }
      : "skip",
  );
  const deleteDeptEligibility = useQuery(
    api.departments.deleteEligibility,
    crudOpen &&
      crudMode === "delete" &&
      crudEntity === "Department" &&
      crudTargetId
      ? { departmentId: crudTargetId as Id<"departments"> }
      : "skip",
  );
  const deleteProcEligibility = useQuery(
    api.processes.deleteEligibility,
    crudOpen &&
      crudMode === "delete" &&
      crudEntity === "Process" &&
      crudTargetId
      ? { processId: crudTargetId as Id<"processes"> }
      : "skip",
  );
  const deleteEligibility =
    crudEntity === "Function"
      ? deleteFnEligibility
      : crudEntity === "Department"
        ? deleteDeptEligibility
        : deleteProcEligibility;

  const handleOpenDeleteCleanup = useCallback(() => {
    if (crudEntity !== "Process" || !crudTargetId) return;
    setCrudOpen(false);
    router.push(
      routes.withWorkspacePath(
        `/admin/conversations?processId=${crudTargetId}`,
      ),
    );
  }, [crudEntity, crudTargetId, router, routes]);

  const openCrud = useCallback(
    (
      mode: "create" | "edit" | "delete",
      entity: "Function" | "Department" | "Process",
      targetName?: string,
      targetId?: string,
      currentLocationId?: string,
      currentDescription?: string,
    ) => {
      setCrudMode(mode);
      setCrudEntity(entity);
      setCrudTargetName(targetName ?? "");
      setCrudTargetDescription(currentDescription ?? "");
      setCrudTargetId(targetId ?? null);
      setCrudCurrentLocationId(currentLocationId ?? null);
      setCrudOpen(true);
    },
    [],
  );

  // Convex queries
  const hierarchyTree = useQuery(api.hierarchy.getTree);
  const functions = useQuery(api.functions.list);
  const departments = useQuery(
    api.departments.listByFunction,
    selectedFunctionId ? { functionId: selectedFunctionId } : "skip",
  );
  const processes = useQuery(
    api.processes.listByDepartment,
    selectedDepartmentId ? { departmentId: selectedDepartmentId } : "skip",
  );
  const selectedProcess = useQuery(
    api.processes.get,
    selectedProcessId ? { processId: selectedProcessId } : "skip",
  );
  const processWorkbench = useQuery(
    api.processes.getWorkbench,
    selectedProcessId ? { processId: selectedProcessId } : "skip",
  );
  const selectedDepartment = useQuery(
    api.departments.get,
    selectedDepartmentId ? { departmentId: selectedDepartmentId } : "skip",
  );
  const selectedFunction = useQuery(
    api.functions.get,
    selectedFunctionId ? { functionId: selectedFunctionId } : "skip",
  );
  const allDepartments = useQuery(api.departments.listAll);
  const allProcesses = useQuery(api.processes.listAll);
  const attentionProcessIds = useQuery(
    api.conversations.processIdsNeedingAttention,
  );
  const processConversations = useQuery(
    api.conversations.listByProcess,
    selectedProcessId ? { processId: selectedProcessId } : "skip",
  );
  const completedProcessConversationCount =
    processConversations?.filter(
      (conversation) => conversation.status === "done",
    ).length ?? 0;
  const pendingProcessConversations = useMemo(
    () => ({
      processing:
        processConversations?.filter(
          (conversation) => conversation.status === "processing",
        ).length ?? 0,
      needsLabels:
        processConversations?.filter(
          (conversation) => conversation.status === "needs_speaker_labels",
        ).length ?? 0,
    }),
    [processConversations],
  );
  const departmentOverviewChildren = useMemo<
    HierarchyChildSummary[] | undefined
  >(
    () =>
      processes?.map((process) => ({
        kind: "process" as const,
        id: process._id,
        name: process.name,
        state: process.summaryOverview.state,
        format: process.summaryOverview.format,
        generatedAt: process.summaryOverview.generatedAt,
        coverage: process.summaryOverview.coverage,
      })),
    [processes],
  );
  const functionOverviewChildren = useMemo<
    HierarchyChildSummary[] | undefined
  >(
    () =>
      departments?.map((department) => ({
        kind: "department" as const,
        id: department._id,
        name: department.name,
        state: department.summaryOverview.state,
        format: department.summaryOverview.format,
        generatedAt: department.summaryOverview.generatedAt,
        coverage: department.summaryOverview.coverage,
      })),
    [departments],
  );

  // Row scent, derived from the lists already loaded for navigation/search
  // (no per-row queries). See plan: "compute on read".
  const departmentCountByFunction = useMemo(() => {
    const map = new Map<Id<"functions">, number>();
    for (const dept of allDepartments ?? []) {
      map.set(dept.functionId, (map.get(dept.functionId) ?? 0) + 1);
    }
    return map;
  }, [allDepartments]);
  const processCountByDepartment = useMemo(() => {
    const map = new Map<Id<"departments">, number>();
    for (const proc of allProcesses ?? []) {
      map.set(proc.departmentId, (map.get(proc.departmentId) ?? 0) + 1);
    }
    return map;
  }, [allProcesses]);
  const attentionProcessIdSet = useMemo(
    () => new Set(attentionProcessIds ?? []),
    [attentionProcessIds],
  );
  // Phone rows read their status from the tree, so they flag exactly what the
  // desktop tree does.
  const treeRowInfo = useMemo(() => {
    const byId = new Map<string, { status: StatusMeta | null; detail?: string }>();
    for (const fn of hierarchyTree?.functions ?? []) {
      byId.set(fn._id, { status: overviewRowStatus(fn.summaryOverview.state) });
      for (const department of fn.departments) {
        byId.set(department._id, {
          status: overviewRowStatus(department.summaryOverview.state),
        });
        for (const process of department.processes) {
          byId.set(process._id, {
            status: processRowStatus(process.pendingWorkStatus),
            detail: interviewCountLabel(process.conversationCount),
          });
        }
      }
    }
    return byId;
  }, [hierarchyTree]);

  // Display names sourced from the reactive docs so renames reflect immediately,
  // falling back to the snapshot captured at selection time while the doc loads.
  const functionDisplayName = selectedFunction?.name ?? selectedFunctionName;
  const departmentDisplayName =
    selectedDepartment?.name ?? selectedDepartmentName;
  const processDisplayName = selectedProcess?.name ?? selectedProcessName;
  const workbenchFunctionName =
    processWorkbench?.function.name ?? functionDisplayName;
  const workbenchDepartmentName =
    processWorkbench?.department.name ?? departmentDisplayName;
  const workbenchProcessName =
    processWorkbench?.process.name ?? processDisplayName;
  const functionBreadcrumbQuery = buildSelectionQuery(searchParams, {
    fn: selectedFunctionId,
    dept: null,
    proc: null,
    tab: detailTab,
    node: null,
  });
  const departmentBreadcrumbQuery = buildSelectionQuery(searchParams, {
    fn: selectedFunctionId,
    dept: selectedDepartmentId,
    proc: null,
    tab: detailTab,
    node: null,
  });
  const functionBreadcrumbHref = `${pathname}${
    functionBreadcrumbQuery ? `?${functionBreadcrumbQuery}` : ""
  }`;
  const departmentBreadcrumbHref = `${pathname}${
    departmentBreadcrumbQuery ? `?${departmentBreadcrumbQuery}` : ""
  }`;
  const homeBreadcrumbQuery = buildSelectionQuery(searchParams, {
    fn: null,
    dept: null,
    proc: null,
    tab: detailTab,
    node: null,
  });
  const homeBreadcrumbHref = `${pathname}${
    homeBreadcrumbQuery ? `?${homeBreadcrumbQuery}` : ""
  }`;
  const safeDepartmentDescription =
    (selectedDepartment?.descriptionSafetyStatus ??
      processWorkbench?.department.descriptionSafetyStatus) === "safe"
      ? (selectedDepartment?.description ??
        processWorkbench?.department.description ??
        undefined)
      : undefined;
  const safeProcessDescription =
    (selectedProcess?.descriptionSafetyStatus ??
      processWorkbench?.process.descriptionSafetyStatus) === "safe"
      ? (selectedProcess?.description ??
        processWorkbench?.process.description ??
        undefined)
      : undefined;

  // Clear selection when a selected entity is removed out from under us (e.g.
  // deleted by another member). The `get` queries resolve to `null` (not
  // `undefined`) only once loaded-and-missing, so this never fires mid-load,
  // and clearing the id skips the query so the null condition can't re-fire.
  //
  // This is the legitimate "subscribe to an external system, setState when it
  // changes" case the lint rule below describes — the external system is the
  // Convex reactive store telling us the doc no longer exists.
  /* eslint-disable react-hooks/set-state-in-effect -- reacting to a Convex subscription; see note above */
  useEffect(() => {
    if (selectedFunctionId && selectedFunction === null) {
      setSelectedFunctionId(null);
      setSelectedFunctionName("");
      setSelectedDepartmentId(null);
      setSelectedDepartmentName("");
      setSelectedProcessId(null);
      setSelectedProcessName("");
      setFlowNodeId(null);
    }
  }, [selectedFunctionId, selectedFunction]);

  useEffect(() => {
    if (selectedDepartmentId && selectedDepartment === null) {
      setSelectedDepartmentId(null);
      setSelectedDepartmentName("");
      setSelectedProcessId(null);
      setSelectedProcessName("");
      setFlowNodeId(null);
    }
  }, [selectedDepartmentId, selectedDepartment]);

  useEffect(() => {
    if (selectedProcessId && selectedProcess === null) {
      setSelectedProcessId(null);
      setSelectedProcessName("");
      setFlowNodeId(null);
    }
  }, [selectedProcessId, selectedProcess]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // A shared process link may arrive with only `proc` in the query string.
  // Hydrate the missing ancestors from the workbench read model so the tree and
  // URL can settle on the full function -> department -> process path.
  /* eslint-disable react-hooks/set-state-in-effect -- reacting to Convex data for a URL-selected process */
  useEffect(() => {
    if (!selectedProcessId || !processWorkbench) return;

    const nextFunctionId = processWorkbench.function._id;
    const nextFunctionName = processWorkbench.function.name;
    const nextDepartmentId = processWorkbench.department._id;
    const nextDepartmentName = processWorkbench.department.name;
    const nextProcessName = processWorkbench.process.name;

    if (selectedFunctionId !== nextFunctionId) {
      setSelectedFunctionId(nextFunctionId);
    }
    if (selectedFunctionName !== nextFunctionName) {
      setSelectedFunctionName(nextFunctionName);
    }
    if (selectedDepartmentId !== nextDepartmentId) {
      setSelectedDepartmentId(nextDepartmentId);
    }
    if (selectedDepartmentName !== nextDepartmentName) {
      setSelectedDepartmentName(nextDepartmentName);
    }
    if (selectedProcessName !== nextProcessName) {
      setSelectedProcessName(nextProcessName);
    }
  }, [
    selectedProcessId,
    processWorkbench,
    selectedFunctionId,
    selectedFunctionName,
    selectedDepartmentId,
    selectedDepartmentName,
    selectedProcessName,
  ]);

  // The same for a selected department moved to another function: the
  // selection follows it rather than closing. (A selected process is followed
  // by the effect above.)
  useEffect(() => {
    if (selectedProcessId || !selectedDepartmentId || !selectedDepartment) {
      return;
    }
    if (selectedFunctionId !== selectedDepartment.functionId) {
      setSelectedFunctionId(selectedDepartment.functionId);
      setSelectedFunctionName("");
    }
  }, [
    selectedProcessId,
    selectedDepartmentId,
    selectedDepartment,
    selectedFunctionId,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // --- URL <-> selection synchronization ---
  //
  // `committed` is the selection the URL should reflect. On mobile a row tap can
  // *preview* an item (loading its summary) without drilling in, so only ids
  // at-or-above the current drill level count as committed; on desktop every
  // selected id is committed.
  const committed = useMemo<SelectionParams>(() => {
    const ids = isMobile
      ? {
          fn: mobileLevel >= 2 ? selectedFunctionId : null,
          dept: mobileLevel >= 3 ? selectedDepartmentId : null,
          proc: mobileLevel >= 4 ? selectedProcessId : null,
        }
      : {
          fn: selectedFunctionId,
          dept: selectedDepartmentId,
          proc: selectedProcessId,
        };
    return {
      ...ids,
      tab: detailTab,
      node: ids.proc && detailTab === 2 ? flowNodeId : null,
    };
  }, [
    isMobile,
    mobileLevel,
    selectedFunctionId,
    selectedDepartmentId,
    selectedProcessId,
    detailTab,
    flowNodeId,
  ]);

  // Write: mirror the committed selection into the URL so that Back, in the
  // app or the browser, walks up the hierarchy: moving deeper pushes, a tab,
  // flow step or tidy-up (a consumed `conv` link) at the same place replaces,
  // and moving up returns to the entry the user came down from. Keyed on
  // `committed` ONLY — deliberately NOT on `searchParams` — so that an inbound
  // URL change (Back/Forward, applied by the read effect below) can't race
  // this effect into re-pushing the pre-navigation selection.
  useEffect(() => {
    if (committed.proc && (!committed.fn || !committed.dept)) {
      return;
    }

    const target = buildSelectionQuery(searchParams, committed);
    if (target === searchParams.toString()) return;

    const href = target ? `${pathname}?${target}` : pathname;
    const move = planHistoryMove(
      historyTrail.current,
      readSelectionParams(searchParams),
      committed,
    );
    historyTrail.current = applyHistoryMove(historyTrail.current, move, target);
    if (move.kind === "back") window.history.go(-move.steps);
    else if (move.kind === "replace") router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- excludes `searchParams` by design; see note above
  }, [committed, pathname, router]);

  // Read: reconcile state when the URL changes from the outside (Back/Forward,
  // deep link). Keyed on `searchParams` ONLY — deliberately NOT on the selection
  // state — so a local selection change can't be clobbered before the write
  // effect runs. Names reset to "" and re-resolve via the *DisplayName fallbacks.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- reacting to external URL changes; deps limited to `searchParams` by design */
  useEffect(() => {
    historyTrail.current = followUrlChange(
      historyTrail.current,
      searchParams.toString(),
    );
    const next = readSelectionParams(searchParams);
    if (
      next.fn !== selectedFunctionId ||
      next.dept !== selectedDepartmentId ||
      next.proc !== selectedProcessId ||
      next.tab !== detailTab ||
      next.node !== flowNodeId
    ) {
      setSelectedFunctionId(next.fn);
      setSelectedDepartmentId(next.dept);
      setSelectedProcessId(next.proc);
      setSelectedFunctionName("");
      setSelectedDepartmentName("");
      setSelectedProcessName("");
      setMobileLevel(deepestMobileLevel(next));
      setDetailTab(next.tab);
      setFlowNodeId(next.node);
    }
  }, [searchParams]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  // Feed the home's "Pick up where you left off" with processes actually opened
  // (a mobile preview is not committed), once the process is confirmed to exist.
  const membershipUserId = membership?.userId ?? null;
  const membershipOrgId = membership?.orgId ?? null;
  useEffect(() => {
    if (!membershipUserId || !membershipOrgId || !committed.proc) return;
    if (selectedProcess?._id !== committed.proc) return;
    rememberRecentProcess(membershipUserId, membershipOrgId, committed.proc);
  }, [committed.proc, membershipOrgId, membershipUserId, selectedProcess?._id]);

  // Location options for edit modals
  const departmentLocationOptions = (functions ?? []).map((fn) => ({
    value: fn._id,
    label: fn.name,
  }));
  const processLocationOptions = (allDepartments ?? []).map((dept) => ({
    value: dept._id,
    label: dept.name,
    group: dept.functionName,
  }));

  // Selection handlers
  const handleSelectFunction = useCallback(
    (id: Id<"functions">, name: string) => {
      setSelectedFunctionId(id);
      setSelectedFunctionName(name);
      setSelectedDepartmentId(null);
      setSelectedDepartmentName("");
      setSelectedProcessId(null);
      setSelectedProcessName("");
      setFlowNodeId(null);
      setMobilePreview(null);
      setMobileLevel(2);
    },
    [],
  );

  const handlePreviewFunction = useCallback(
    (id: Id<"functions">, name: string) => {
      setSelectedFunctionId(id);
      setSelectedFunctionName(name);
      setSelectedDepartmentId(null);
      setSelectedDepartmentName("");
      setSelectedProcessId(null);
      setSelectedProcessName("");
      setFlowNodeId(null);
      setMobilePreview({ type: "function", id, name });
    },
    [],
  );

  const handleSelectDepartment = useCallback(
    (id: Id<"departments">, name: string) => {
      setSelectedDepartmentId(id);
      setSelectedDepartmentName(name);
      setSelectedProcessId(null);
      setSelectedProcessName("");
      setFlowNodeId(null);
      setMobilePreview(null);
      setMobileLevel(3);
    },
    [],
  );

  const handlePreviewDepartment = useCallback(
    (id: Id<"departments">, name: string) => {
      setSelectedDepartmentId(id);
      setSelectedDepartmentName(name);
      setSelectedProcessId(null);
      setSelectedProcessName("");
      setFlowNodeId(null);
      setMobilePreview({ type: "department", id, name });
    },
    [],
  );

  const handleSelectProcess = useCallback(
    (id: Id<"processes">, name: string) => {
      setSelectedProcessId(id);
      setSelectedProcessName(name);
      setFlowNodeId(null);
      setMobilePreview(null);
      setMobileLevel(4);
    },
    [],
  );

  const handlePreviewProcess = useCallback(
    (id: Id<"processes">, name: string) => {
      setSelectedProcessId(id);
      setSelectedProcessName(name);
      setFlowNodeId(null);
      setMobilePreview({ type: "process", id, name });
    },
    [],
  );

  const handleSelectHome = useCallback(() => {
    setSelectedFunctionId(null);
    setSelectedFunctionName("");
    setSelectedDepartmentId(null);
    setSelectedDepartmentName("");
    setSelectedProcessId(null);
    setSelectedProcessName("");
    setFlowNodeId(null);
    setMobilePreview(null);
    setMobileLevel(1);
  }, []);

  // Breadcrumbs move up, keeping the ancestors selected.
  const handleBreadcrumbFunction = useCallback(() => {
    setSelectedDepartmentId(null);
    setSelectedProcessId(null);
    setMobileLevel(2);
  }, []);

  const handleBreadcrumbDepartment = useCallback(() => {
    setSelectedProcessId(null);
    setMobileLevel(3);
  }, []);

  // --- Command palette (⌘K jump-to-anything) ---
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Jump straight to a full selection path (sets every level at once); the
  // Phase-2 URL write effect then mirrors it to the query string.
  const jumpToDepartment = useCallback(
    (
      functionId: Id<"functions">,
      functionName: string,
      departmentId: Id<"departments">,
      departmentName: string,
    ) => {
      setSelectedFunctionId(functionId);
      setSelectedFunctionName(functionName);
      setSelectedDepartmentId(departmentId);
      setSelectedDepartmentName(departmentName);
      setSelectedProcessId(null);
      setSelectedProcessName("");
      setMobilePreview(null);
      setMobileLevel(3);
    },
    [],
  );

  const jumpToProcess = useCallback(
    (
      functionId: Id<"functions">,
      functionName: string,
      departmentId: Id<"departments">,
      departmentName: string,
      processId: Id<"processes">,
      processName: string,
    ) => {
      setSelectedFunctionId(functionId);
      setSelectedFunctionName(functionName);
      setSelectedDepartmentId(departmentId);
      setSelectedDepartmentName(departmentName);
      setSelectedProcessId(processId);
      setSelectedProcessName(processName);
      setMobilePreview(null);
      setMobileLevel(4);
    },
    [],
  );

  // Selects a node and opens the way to it: the desktop tree expands its
  // ancestors and phones drill into it. The caller passes the whole path, so
  // this works for a node the hierarchy tree hasn't loaded yet, such as one
  // just created by an action.
  const selectAndReveal = useCallback(
    (path: RevealPath) => {
      setFlowNodeId(null);
      if (path.kind === "function") {
        handleSelectFunction(path.functionId, path.functionName);
      } else if (path.kind === "department") {
        jumpToDepartment(
          path.functionId,
          path.functionName,
          path.departmentId,
          path.departmentName,
        );
      } else {
        jumpToProcess(
          path.functionId,
          path.functionName,
          path.departmentId,
          path.departmentName,
          path.processId,
          path.processName,
        );
      }
    },
    [handleSelectFunction, jumpToDepartment, jumpToProcess],
  );

  // Create, edit and delete from the CRUD dialog. A create lands on what it
  // made, so the next level's Add button is ready. Creating under a row other
  // than the current selection selects that row first (see the tree and home
  // create handlers below), so the parent here is always the selection.
  const handleCrudConfirm = useCallback(
    async (name: string, newLocationId?: string, description?: string) => {
      if (crudEntity === "Function") {
        if (crudMode === "create") {
          const functionId = await createFunction({ name });
          selectAndReveal({ kind: "function", functionId, functionName: name });
        } else if (crudMode === "edit" && crudTargetId) {
          await updateFunction({
            functionId: crudTargetId as Id<"functions">,
            name,
          });
        } else if (crudMode === "delete" && crudTargetId) {
          await removeFunction({ functionId: crudTargetId as Id<"functions"> });
          if (selectedFunctionId === crudTargetId) {
            setSelectedFunctionId(null);
            setSelectedDepartmentId(null);
            setSelectedProcessId(null);
          }
        }
      } else if (crudEntity === "Department") {
        if (crudMode === "create" && selectedFunctionId) {
          const departmentId = await createDepartment({
            functionId: selectedFunctionId,
            name,
            description,
          });
          selectAndReveal({
            kind: "department",
            functionId: selectedFunctionId,
            functionName: selectedFunctionName,
            departmentId,
            departmentName: name,
          });
        } else if (crudMode === "edit" && crudTargetId) {
          const newFunctionId = newLocationId as Id<"functions"> | undefined;
          await updateDepartment({
            departmentId: crudTargetId as Id<"departments">,
            name,
            functionId: newFunctionId,
            description,
          });
        } else if (crudMode === "delete" && crudTargetId) {
          await removeDepartment({
            departmentId: crudTargetId as Id<"departments">,
          });
          if (selectedDepartmentId === crudTargetId) {
            setSelectedDepartmentId(null);
            setSelectedProcessId(null);
          }
        }
      } else if (crudEntity === "Process") {
        if (crudMode === "create" && selectedDepartmentId) {
          const processId = await createProcess({
            departmentId: selectedDepartmentId,
            name,
            description,
          });
          // The function is always known by now; a `dept`-only link fills it
          // in as soon as the department loads.
          if (selectedFunctionId) {
            selectAndReveal({
              kind: "process",
              functionId: selectedFunctionId,
              functionName: selectedFunctionName,
              departmentId: selectedDepartmentId,
              departmentName: selectedDepartmentName,
              processId,
              processName: name,
            });
          }
        } else if (crudMode === "edit" && crudTargetId) {
          const newDepartmentId = newLocationId as
            Id<"departments"> | undefined;
          await updateProcess({
            processId: crudTargetId as Id<"processes">,
            name,
            departmentId: newDepartmentId,
            description,
          });
        } else if (crudMode === "delete" && crudTargetId) {
          await removeProcess({ processId: crudTargetId as Id<"processes"> });
          if (selectedProcessId === crudTargetId) {
            setSelectedProcessId(null);
          }
        }
      }
    },
    [
      crudEntity,
      crudMode,
      crudTargetId,
      selectedFunctionId,
      selectedFunctionName,
      selectedDepartmentId,
      selectedDepartmentName,
      selectedProcessId,
      selectAndReveal,
      createFunction,
      updateFunction,
      removeFunction,
      createDepartment,
      updateDepartment,
      removeDepartment,
      createProcess,
      updateProcess,
      removeProcess,
    ],
  );

  const handleTreeSelectFunction = useCallback(
    (fn: ProcessTreeFunction) => {
      handleSelectFunction(fn._id, fn.name);
    },
    [handleSelectFunction],
  );

  const handleTreeSelectDepartment = useCallback(
    (fn: ProcessTreeFunction, department: ProcessTreeDepartment) => {
      jumpToDepartment(fn._id, fn.name, department._id, department.name);
    },
    [jumpToDepartment],
  );

  const handleTreeSelectProcess = useCallback(
    (
      fn: ProcessTreeFunction,
      department: ProcessTreeDepartment,
      process: ProcessTreeProcess,
    ) => {
      jumpToProcess(
        fn._id,
        fn.name,
        department._id,
        department.name,
        process._id,
        process.name,
      );
    },
    [jumpToProcess],
  );

  const handleTreeCreateDepartment = useCallback(
    (fn: ProcessTreeFunction) => {
      handleSelectFunction(fn._id, fn.name);
      openCrud("create", "Department");
    },
    [handleSelectFunction, openCrud],
  );

  const handleTreeCreateProcess = useCallback(
    (fn: ProcessTreeFunction, department: ProcessTreeDepartment) => {
      jumpToDepartment(fn._id, fn.name, department._id, department.name);
      openCrud("create", "Process");
    },
    [jumpToDepartment, openCrud],
  );

  const handleTreeEditFunction = useCallback(
    (fn: ProcessTreeFunction) => {
      openCrud("edit", "Function", fn.name, fn._id);
    },
    [openCrud],
  );

  const handleTreeDeleteFunction = useCallback(
    (fn: ProcessTreeFunction) => {
      openCrud("delete", "Function", fn.name, fn._id);
    },
    [openCrud],
  );

  const handleTreeEditDepartment = useCallback(
    (_fn: ProcessTreeFunction, department: ProcessTreeDepartment) => {
      openCrud(
        "edit",
        "Department",
        department.name,
        department._id,
        department.functionId,
        department.description ?? undefined,
      );
    },
    [openCrud],
  );

  const handleTreeDeleteDepartment = useCallback(
    (_fn: ProcessTreeFunction, department: ProcessTreeDepartment) => {
      openCrud("delete", "Department", department.name, department._id);
    },
    [openCrud],
  );

  const handleTreeEditProcess = useCallback(
    (
      _fn: ProcessTreeFunction,
      _department: ProcessTreeDepartment,
      process: ProcessTreeProcess,
    ) => {
      openCrud(
        "edit",
        "Process",
        process.name,
        process._id,
        process.departmentId,
        process.description ?? undefined,
      );
    },
    [openCrud],
  );

  const handleTreeDeleteProcess = useCallback(
    (
      _fn: ProcessTreeFunction,
      _department: ProcessTreeDepartment,
      process: ProcessTreeProcess,
    ) => {
      openCrud("delete", "Process", process.name, process._id);
    },
    [openCrud],
  );

  const handleCopyProcessLink = useCallback(async () => {
    if (!selectedProcessId) return false;

    const target = buildSelectionQuery(searchParams, {
      fn: selectedFunctionId,
      dept: selectedDepartmentId,
      proc: selectedProcessId,
      tab: detailTab,
      node: detailTab === 2 ? flowNodeId : null,
    });
    const url = `${window.location.origin}${pathname}${target ? `?${target}` : ""}`;
    return await copyTextToClipboard(url);
  }, [
    detailTab,
    flowNodeId,
    pathname,
    searchParams,
    selectedDepartmentId,
    selectedFunctionId,
    selectedProcessId,
  ]);

  const handleOpenRecordingMode = useCallback((mode: RecordingMode) => {
    setRecordingMode(mode);
    setRecordingOpen(true);
  }, []);

  const handleJumpToLabeling = useCallback(() => {
    setFlowNodeId(null);
    setDetailTab(1);
    setLabelingJumpKey((key) => key + 1);
  }, []);

  const handleOpenOverviewConversation = useCallback(
    (conversationId: Id<"conversations">) => {
      setConversationFocusId(conversationId);
      setConversationFocusJumpKey((key) => key + 1);
      setFlowNodeId(null);
      setDetailTab(1);
    },
    [],
  );

  // --- Workspace home (right panel when nothing is selected) ---
  const handleHomeOpenProcess = useCallback(
    ({ fn, department, process }: HomeProcessEntry) => {
      setFlowNodeId(null);
      jumpToProcess(
        fn._id,
        fn.name,
        department._id,
        department.name,
        process._id,
        process.name,
      );
    },
    [jumpToProcess],
  );

  // Phones have no department overview screen; the overview lives in the
  // preview sheet, whose footer drills into the department's processes.
  const handleHomeOpenDepartment = useCallback(
    ({ fn, department }: HomeDepartmentEntry) => {
      if (isMobile) {
        setSelectedFunctionId(fn._id);
        setSelectedFunctionName(fn.name);
        handlePreviewDepartment(department._id, department.name);
        return;
      }
      jumpToDepartment(fn._id, fn.name, department._id, department.name);
    },
    [handlePreviewDepartment, isMobile, jumpToDepartment],
  );

  const handleHomeCreateProcess = useCallback(
    ({ fn, department }: HomeDepartmentEntry) => {
      handleTreeCreateProcess(fn, department);
    },
    [handleTreeCreateProcess],
  );

  // --- Getting started (first-run onboarding) ---
  // The card builds from Home, so new functions and departments are revealed
  // in the tree without selecting them; only a new process is opened.
  const onboarding = useQuery(api.onboarding.getMyOnboarding);
  const markHintSeen = useMutation(api.onboarding.markHintSeen);
  const [treeReveal, setTreeReveal] = useState<TreeReveal | null>(null);
  // The process the capture hint is for; it shows only while that process
  // is open.
  const [captureHintProcessId, setCaptureHintProcessId] =
    useState<Id<"processes"> | null>(null);
  const captureHintSeen = onboarding?.hints.captureSeen ?? true;

  const revealInTree = useCallback((path: RevealPath) => {
    setTreeReveal({
      nodeId:
        path.kind === "function"
          ? path.functionId
          : path.kind === "department"
            ? path.departmentId
            : path.processId,
      functionId: path.functionId,
      departmentId: path.kind === "function" ? undefined : path.departmentId,
      key: Date.now(),
    });
  }, []);

  const openFromGettingStarted = useCallback(
    (path: ProcessPath, options?: { captureHint?: boolean; tab?: "flow" }) => {
      selectAndReveal(path);
      if (options?.tab === "flow") setDetailTab(2);
      if (options?.captureHint && !captureHintSeen) {
        setCaptureHintProcessId(path.processId);
      }
    },
    [captureHintSeen, selectAndReveal],
  );

  const gettingStartedActions = useMemo<GettingStartedActions>(
    () => ({
      onReveal: revealInTree,
      onOpenProcess: openFromGettingStarted,
      onSeeInTree: () => setMobileHomeView("browse"),
    }),
    [openFromGettingStarted, revealInTree],
  );

  // --- Explore walkthrough (desktop) / sheet (phones and tablets) ---
  const resolveWalkthrough = useMutation(api.onboarding.resolveWalkthrough);
  const myPlacement = useQuery(api.users.getMyPlacement);
  // Whether the visit began on a link to a function, department or process.
  const [arrivedOnDeepLink] = useState(() =>
    Boolean(initialSelection.fn || initialSelection.dept || initialSelection.proc),
  );
  const [tourActive, setTourActive] = useState(false);
  // Each start remounts the walkthrough, so a replay begins at step 1.
  const [tourRun, setTourRun] = useState(0);
  const [deepLinkToastDue, setDeepLinkToastDue] = useState(false);

  const startTour = useCallback(() => {
    setTourRun((run) => run + 1);
    setTourActive(true);
  }, []);

  // Decided once per visit, when onboarding state and the tree have loaded.
  const [tourStartDecided, setTourStartDecided] = useState(false);
  if (
    !tourStartDecided &&
    onboarding !== undefined &&
    hierarchyTree !== undefined
  ) {
    setTourStartDecided(true);
    if (onboarding) {
      const pendingExplore = {
        path: onboarding.path,
        welcomed: onboarding.welcomed,
        walkthrough: onboarding.walkthrough,
      };
      if (shouldAutoStartWalkthrough({ ...pendingExplore, deepLink: arrivedOnDeepLink })) {
        startTour();
      } else if (
        arrivedOnDeepLink &&
        shouldAutoStartWalkthrough({ ...pendingExplore, deepLink: false })
      ) {
        setDeepLinkToastDue(true);
      }
    }
  }

  // A deep link means they came for something specific: offer, don't start.
  useEffect(() => {
    if (!deepLinkToastDue) return;
    toast("New here?", {
      id: "show-me-around",
      description: "Take a quick look at how this workspace is organized.",
      duration: 15_000,
      action: { label: "Show me around", onClick: startTour },
    });
  }, [deepLinkToastDue, startTour]);

  // Help → Show me around and the waiting card's button.
  useEffect(() => {
    window.addEventListener(SHOW_ME_AROUND_EVENT, startTour);
    return () => window.removeEventListener(SHOW_ME_AROUND_EVENT, startTour);
  }, [startTour]);

  const walkthroughStepList = useMemo(
    () =>
      hierarchyTree && tourActive
        ? walkthroughSteps({
            canCapture: canEdit,
            tree: hierarchyTree,
            placementDepartmentId: myPlacement?.placement?.departmentId ?? null,
          })
        : [],
    [canEdit, hierarchyTree, myPlacement, tourActive],
  );

  const finishTour = useCallback(
    (outcome: WalkthroughOutcome) => {
      setTourActive(false);
      // First outcome wins on the server; a replay changes nothing there.
      resolveWalkthrough({ outcome }).catch((err: unknown) => {
        console.warn("Couldn't save the walkthrough outcome", err);
      });
    },
    [resolveWalkthrough],
  );

  const dismissCaptureHint = useCallback(() => {
    setCaptureHintProcessId(null);
    markHintSeen({ hint: "capture" }).catch((err: unknown) => {
      console.warn("Couldn't save that the capture hint was seen", err);
    });
  }, [markHintSeen]);

  const handleHomeCapture = useCallback(
    (entry: HomeProcessEntry, mode: RecordingMode) => {
      handleHomeOpenProcess(entry);
      handleOpenRecordingMode(mode);
    },
    [handleHomeOpenProcess, handleOpenRecordingMode],
  );

  const handleHomeOpenConversation = useCallback(
    (conversation: MyConversation) => {
      jumpToProcess(
        conversation.functionId,
        conversation.functionName,
        conversation.departmentId,
        conversation.departmentName,
        conversation.processId,
        conversation.processName,
      );
      handleOpenOverviewConversation(conversation._id);
    },
    [handleOpenOverviewConversation, jumpToProcess],
  );

  const handleOpenProcessFlow = useCallback((nodeId?: string) => {
    setFlowNodeId(nodeId ?? null);
    setDetailTab(2);
  }, []);

  const handleOpenOverviewProcess = useCallback(
    (processId: Id<"processes">) => {
      const process = processes?.find((row) => row._id === processId);
      if (process) handleSelectProcess(process._id, process.name);
    },
    [handleSelectProcess, processes],
  );

  const handleOpenOverviewDepartment = useCallback(
    (departmentId: Id<"departments">) => {
      const department = departments?.find((row) => row._id === departmentId);
      if (department) {
        handleSelectDepartment(department._id, department.name);
      }
    },
    [departments, handleSelectDepartment],
  );

  const handleEditSelectedProcess = useCallback(() => {
    if (!selectedProcessId) return;
    openCrud(
      "edit",
      "Process",
      workbenchProcessName,
      selectedProcessId,
      selectedProcess?.departmentId ?? processWorkbench?.process.departmentId,
      selectedProcess?.description ??
        processWorkbench?.process.description ??
        undefined,
    );
  }, [
    openCrud,
    processWorkbench,
    selectedProcess,
    selectedProcessId,
    workbenchProcessName,
  ]);

  const handleDeleteSelectedProcess = useCallback(() => {
    if (!selectedProcessId) return;
    openCrud("delete", "Process", workbenchProcessName, selectedProcessId);
  }, [openCrud, selectedProcessId, workbenchProcessName]);

  const handleDownloadProcess = useCallback(() => {
    if (!selectedProcessId) return;
    void downloadProcessPdf({
      processId: selectedProcessId,
      processName: workbenchProcessName,
      functionName: workbenchFunctionName,
      departmentName: workbenchDepartmentName,
      contributorName: processWorkbench?.latestContributor?.name ?? null,
      submittedByName:
        processWorkbench?.latestContributor?.submittedByName ?? null,
      lastUpdatedAt: processWorkbench?.lastUpdatedAt ?? null,
      completedConversationCount: completedProcessConversationCount,
    });
  }, [
    downloadProcessPdf,
    selectedProcessId,
    workbenchProcessName,
    workbenchFunctionName,
    workbenchDepartmentName,
    processWorkbench,
    completedProcessConversationCount,
  ]);

  // --- Phone navigation columns ---
  // From `lg` up the hierarchy is the nested ProcessTreeNavigator. Below it,
  // these single columns are the drill-down (functions → departments →
  // processes → detail), driven by `mobileLevel`; `detailPanel` is shared by
  // both layouts. Tapping a row drills in, and its info button previews the
  // item in a sheet without leaving the list.

  const rowActions = (
    onEdit: () => void,
    onDelete: () => void,
  ): ColumnItemAction[] =>
    canEdit
      ? [
          { label: "Edit", icon: Pencil, onSelect: onEdit },
          { label: "Delete", icon: Trash2, onSelect: onDelete, destructive: true },
        ]
      : [];

  const functionsColumn = () => (
    <div className="flex h-full flex-col">
      <ColumnHeader
        title="Functions"
        count={functions?.length}
        onAdd={canEdit ? () => openCrud("create", "Function") : undefined}
        addLabel="Add function"
      />
      <ColumnList>
        {functions === undefined ? (
          <LoadingSpinner />
        ) : functions.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No functions yet"
            description="Organizational functions will appear here."
            actionLabel={canEdit ? "Add function" : undefined}
            onAction={canEdit ? () => openCrud("create", "Function") : undefined}
          />
        ) : (
          functions.map((fn) => {
            const departmentCount = departmentCountByFunction.get(fn._id) ?? 0;
            return (
              <ColumnItem
                key={fn._id}
                label={fn.name}
                selected={selectedFunctionId === fn._id}
                count={departmentCount}
                countLabel={countLabel(departmentCount, "department")}
                status={treeRowInfo.get(fn._id)?.status}
                onOpen={() => handleSelectFunction(fn._id, fn.name)}
                onPreview={() => handlePreviewFunction(fn._id, fn.name)}
                actions={rowActions(
                  () => openCrud("edit", "Function", fn.name, fn._id),
                  () => openCrud("delete", "Function", fn.name, fn._id),
                )}
              />
            );
          })
        )}
      </ColumnList>
    </div>
  );

  // Phone landing screen: the member's home, with the full function list one
  // tap away. Desktop shows the same home in the detail panel beside the tree.
  const mobileLandingColumn = () => (
    <Tabs
      value={mobileHomeView}
      onValueChange={(value) =>
        setMobileHomeView(value === "browse" ? "browse" : "home")
      }
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <div className="shrink-0 border-b bg-background px-3 py-2.5">
        <TabsList
          className="mx-auto w-full max-w-3xl group-data-horizontal/tabs:h-11"
          aria-label="Workspace views"
        >
          <TabsTrigger value="home" className="gap-2 text-sm">
            <House className="size-4" aria-hidden="true" />
            Home
          </TabsTrigger>
          <TabsTrigger value="browse" className="gap-2 text-sm">
            <Layers className="size-4" aria-hidden="true" />
            Browse
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent
        value="home"
        className="min-h-0 flex-1 overflow-y-auto scrollbar-hide"
      >
        <WorkspaceHome
          tree={hierarchyTree}
          canEdit={canEdit}
          recentProcessIds={recentProcessIds}
          mobile
          onOpenProcess={handleHomeOpenProcess}
          onOpenDepartment={handleHomeOpenDepartment}
          onCapture={handleHomeCapture}
          onOpenConversation={handleHomeOpenConversation}
          onCreateProcess={handleHomeCreateProcess}
          onCreateDepartment={handleTreeCreateDepartment}
          onCreateFunction={() => openCrud("create", "Function")}
          gettingStarted={gettingStartedActions}
        />
      </TabsContent>
      <TabsContent value="browse" className="min-h-0 flex-1 overflow-hidden">
        {functionsColumn()}
      </TabsContent>
    </Tabs>
  );

  const departmentsColumn = () => (
    <div className="flex h-full flex-col">
      {/* Back to whichever landing view the user came from. */}
      <BackBar
        label={mobileHomeView === "home" ? "Home" : "Functions"}
        onBack={() => setMobileLevel(1)}
      />
      <ColumnHeader
        title="Departments"
        count={departments?.length}
        onAdd={
          canEdit && selectedFunctionId
            ? () => openCrud("create", "Department")
            : undefined
        }
        addLabel="Add department"
      />
      <ColumnList>
        {!selectedFunctionId ? (
          <EmptyState
            icon={Layers}
            title="Select a function"
            description="Choose a function from the list to see its departments."
          />
        ) : departments === undefined ? (
          <LoadingSpinner />
        ) : departments.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No departments"
            description="This function has no departments defined yet."
            actionLabel={canEdit ? "Add department" : undefined}
            onAction={
              canEdit && selectedFunctionId
                ? () => openCrud("create", "Department")
                : undefined
            }
          />
        ) : (
          departments.map((dept) => {
            const processCount = processCountByDepartment.get(dept._id) ?? 0;
            return (
              <ColumnItem
                key={dept._id}
                label={dept.name}
                selected={selectedDepartmentId === dept._id}
                count={processCount}
                countLabel={countLabel(processCount, "process", "processes")}
                status={treeRowInfo.get(dept._id)?.status}
                onOpen={() => handleSelectDepartment(dept._id, dept.name)}
                onPreview={() => handlePreviewDepartment(dept._id, dept.name)}
                actions={rowActions(
                  () =>
                    openCrud(
                      "edit",
                      "Department",
                      dept.name,
                      dept._id,
                      dept.functionId,
                      dept.description,
                    ),
                  () => openCrud("delete", "Department", dept.name, dept._id),
                )}
              />
            );
          })
        )}
      </ColumnList>
    </div>
  );

  const processesColumn = () => (
    <div className="flex h-full flex-col">
      <BackBar
        label={functionDisplayName || "Departments"}
        onBack={() => setMobileLevel(2)}
      />
      <ColumnHeader
        title="Processes"
        count={processes?.length}
        onAdd={
          canEdit && selectedDepartmentId
            ? () => openCrud("create", "Process")
            : undefined
        }
        addLabel="Add process"
      />
      <ColumnList>
        {!selectedDepartmentId ? (
          <EmptyState
            icon={Cog}
            title="Select a department"
            description="Choose a department to see its processes."
          />
        ) : processes === undefined ? (
          <LoadingSpinner />
        ) : processes.length === 0 ? (
          <EmptyState
            icon={Cog}
            title="No processes"
            description="No processes defined yet for this department."
            actionLabel={canEdit ? "Add process" : undefined}
            onAction={
              canEdit && selectedDepartmentId
                ? () => openCrud("create", "Process")
                : undefined
            }
          />
        ) : (
          processes.map((proc) => (
            <ColumnItem
              key={proc._id}
              label={proc.name}
              selected={selectedProcessId === proc._id}
              detail={treeRowInfo.get(proc._id)?.detail}
              status={
                treeRowInfo.get(proc._id)?.status ??
                // The tree is bounded; past its read limits, fall back to
                // the dedicated needs-labels query.
                (attentionProcessIdSet.has(proc._id)
                  ? processPendingStatusMeta.needs_labels
                  : null)
              }
              onOpen={() => handleSelectProcess(proc._id, proc.name)}
              onPreview={() => handlePreviewProcess(proc._id, proc.name)}
              actions={rowActions(
                () =>
                  openCrud(
                    "edit",
                    "Process",
                    proc.name,
                    proc._id,
                    proc.departmentId,
                    proc.description,
                  ),
                () => openCrud("delete", "Process", proc.name, proc._id),
              )}
            />
          ))
        )}
      </ColumnList>
    </div>
  );

  // Phones capture through a floating button (see ProcessHeader); scrolling
  // tabs end with room for it so it never covers their last lines. The flow
  // canvas pans instead, so it needs none.
  const fabClearance = (mobile?: boolean) =>
    mobile && canEdit ? "pb-24" : undefined;

  const homeCrumb: WorkbenchCrumb = {
    label: "Home",
    href: homeBreadcrumbHref,
    onSelect: handleSelectHome,
  };

  const detailPanel = (mobile?: boolean) => (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      {mobile && (
        <BackBar
          label={departmentDisplayName || "Processes"}
          onBack={() => setMobileLevel(3)}
          contained={false}
        />
      )}
      {!selectedProcessId ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto scrollbar-hide">
          {/* Home brings its own heading; a function or department overview
              gets its name and where it sits. Only reached from `lg` up:
              phones preview these in a sheet. */}
          {selectedFunctionId && (
            <OverviewHeader
              name={
                (selectedDepartmentId
                  ? departmentDisplayName
                  : functionDisplayName) ||
                (selectedDepartmentId ? "Department" : "Function")
              }
              breadcrumb={
                selectedDepartmentId
                  ? [
                      homeCrumb,
                      {
                        label: functionDisplayName || "Function",
                        href: functionBreadcrumbHref,
                        onSelect: handleBreadcrumbFunction,
                      },
                    ]
                  : [homeCrumb]
              }
              actions={
                canEdit && selectedDepartmentId ? (
                  <OverviewActions
                    entityLabel={departmentDisplayName}
                    onEdit={() =>
                      selectedDepartmentId &&
                      openCrud(
                        "edit",
                        "Department",
                        departmentDisplayName,
                        selectedDepartmentId,
                        selectedDepartment?.functionId,
                        selectedDepartment?.description,
                      )
                    }
                    onDelete={() =>
                      selectedDepartmentId &&
                      openCrud(
                        "delete",
                        "Department",
                        departmentDisplayName,
                        selectedDepartmentId,
                      )
                    }
                  />
                ) : canEdit && selectedFunctionId ? (
                  <OverviewActions
                    entityLabel={functionDisplayName}
                    onEdit={() =>
                      selectedFunctionId &&
                      openCrud(
                        "edit",
                        "Function",
                        functionDisplayName,
                        selectedFunctionId,
                      )
                    }
                    onDelete={() =>
                      selectedFunctionId &&
                      openCrud(
                        "delete",
                        "Function",
                        functionDisplayName,
                        selectedFunctionId,
                      )
                    }
                  />
                ) : undefined
              }
            />
          )}

          {/* Unified Department Overview */}
          {selectedDepartmentId && !selectedProcessId && (
            <HierarchyOverview
              entity={{ kind: "department", departmentId: selectedDepartmentId }}
              description={selectedDepartment?.description}
              childSummaries={departmentOverviewChildren}
              canRefresh={canEdit}
              onOpenProcess={handleOpenOverviewProcess}
            />
          )}

          {/* Unified Function Overview */}
          {selectedFunctionId && !selectedDepartmentId && (
            <HierarchyOverview
              entity={{ kind: "function", functionId: selectedFunctionId }}
              childSummaries={functionOverviewChildren}
              canRefresh={canEdit}
              onOpenDepartment={handleOpenOverviewDepartment}
            />
          )}

          {/* No selection at all: the member's workspace home */}
          {!selectedFunctionId && (
            <WorkspaceHome
              tree={hierarchyTree}
              canEdit={canEdit}
              recentProcessIds={recentProcessIds}
              onOpenProcess={handleHomeOpenProcess}
              onOpenDepartment={handleHomeOpenDepartment}
              onCapture={handleHomeCapture}
              onOpenConversation={handleHomeOpenConversation}
              onCreateProcess={handleHomeCreateProcess}
              onCreateDepartment={handleTreeCreateDepartment}
              onCreateFunction={() => openCrud("create", "Function")}
              gettingStarted={gettingStartedActions}
            />
          )}
        </div>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ProcessHeader
            processName={workbenchProcessName}
            workbench={processWorkbench}
            canEdit={canEdit}
            mobile={mobile}
            breadcrumb={[
              homeCrumb,
              {
                label: workbenchFunctionName || "Function",
                href: functionBreadcrumbHref,
                onSelect: handleBreadcrumbFunction,
              },
              {
                label: workbenchDepartmentName || "Department",
                href: departmentBreadcrumbHref,
                onSelect: handleBreadcrumbDepartment,
              },
            ]}
            onCopyLink={handleCopyProcessLink}
            onJumpToLabeling={handleJumpToLabeling}
            onEditProcess={handleEditSelectedProcess}
            onMoveProcess={handleEditSelectedProcess}
            onDeleteProcess={handleDeleteSelectedProcess}
            onDownloadProcess={handleDownloadProcess}
            isDownloading={isDownloadingPdf}
            onStartInterview={() => handleOpenRecordingMode("agent")}
            onRecordVoice={() => handleOpenRecordingMode("voiceRecord")}
            onUploadAudio={() => handleOpenRecordingMode("audioUpload")}
          />

          <Tabs
            value={detailTab}
            onValueChange={(value) => {
              const nextTab = typeof value === "number" ? value : Number(value);
              const safeTab = Number.isFinite(nextTab) ? nextTab : 0;
              if (safeTab !== 2) setFlowNodeId(null);
              setDetailTab(safeTab);
            }}
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden gap-0"
          >
            <div
              className="shrink-0 overflow-x-auto overflow-y-hidden border-b px-2 sm:px-4"
              data-tour="process-tabs"
            >
              <TabsList
                variant="line"
                className="h-10 min-w-max justify-start"
                aria-label="Process workbench sections"
              >
                <TabsTrigger value={0} className="gap-1.5 px-2 text-xs">
                  <FileText className="h-3.5 w-3.5" />
                  Overview
                </TabsTrigger>
                <TabsTrigger value={1} className="gap-1.5 px-2 text-xs">
                  <Mic className="h-3.5 w-3.5" />
                  Conversations
                  {processConversations !== undefined && (
                    <span className="tabs-count-badge ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">
                      {processConversations.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value={2} className="gap-1.5 px-2 text-xs">
                  <GitBranch className="h-3.5 w-3.5" />
                  Process Flow
                </TabsTrigger>
                <TabsTrigger value={3} className="gap-1.5 px-2 text-xs">
                  <BarChart3 className="h-3.5 w-3.5" />
                  Insights
                </TabsTrigger>
                <TabsTrigger value={4} className="gap-1.5 px-2 text-xs">
                  <Bot className="h-3.5 w-3.5" />
                  Automations
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Overview tab */}
            <TabsContent
              value={0}
              className={cn(
                "min-h-0 min-w-0 flex-1 overflow-y-auto",
                fabClearance(mobile),
              )}
            >
              <ProcessOverview
                processId={selectedProcessId!}
                canRefresh={canEdit}
                onOpenConversation={handleOpenOverviewConversation}
                onOpenFlow={() => handleOpenProcessFlow()}
                onOpenInsights={() => {
                  setFlowNodeId(null);
                  setDetailTab(3);
                }}
              />
            </TabsContent>

            {/* Conversations tab */}
            <TabsContent
              value={1}
              className={cn(
                "min-h-0 min-w-0 flex-1 overflow-y-auto md:overflow-hidden",
                fabClearance(mobile),
              )}
            >
              <ProcessConversationsTab
                key={selectedProcessId}
                processId={selectedProcessId!}
                canLabelSpeakers={canEdit}
                canRetry={userRole === "admin"}
                labelingJumpKey={labelingJumpKey}
                focusConversationId={conversationFocusId}
                focusConversationJumpKey={conversationFocusJumpKey}
              />
            </TabsContent>

            {/* Process Flow tab */}
            <TabsContent
              value={2}
              className="min-h-0 min-w-0 flex-1 overflow-y-auto md:overflow-hidden"
            >
              <ProcessFlowTab
                key={selectedProcessId}
                processId={selectedProcessId!}
                conversationCount={completedProcessConversationCount}
                pendingConversations={pendingProcessConversations}
                canEdit={canEdit}
                flow={
                  processWorkbench === undefined
                    ? undefined
                    : (processWorkbench?.flow ?? null)
                }
                selectedNodeId={flowNodeId}
                onSelectedNodeChange={setFlowNodeId}
                onOpenConversation={handleOpenOverviewConversation}
                conversations={(processConversations ?? []).map(
                  (conversation) => ({
                    conversationId: conversation._id,
                    contributorName: conversation.contributorName,
                    creationTime: conversation._creationTime,
                    status: conversation.status,
                  }),
                )}
                onOpenInsights={() => {
                  setFlowNodeId(null);
                  setDetailTab(3);
                }}
              />
            </TabsContent>

            {/* Insights tab */}
            <TabsContent
              value={3}
              className={cn(
                "min-h-0 min-w-0 flex-1 overflow-y-auto scrollbar-hide",
                fabClearance(mobile),
              )}
            >
              <ProcessInsightsTab
                processId={selectedProcessId!}
                completedConversationCount={completedProcessConversationCount}
                canGenerate={canEdit}
                isActive={detailTab === 3}
                onOpenProcessFlow={handleOpenProcessFlow}
                onOpenAutomations={() => {
                  setFlowNodeId(null);
                  setDetailTab(4);
                }}
              />
            </TabsContent>

            {/* Automations tab */}
            <TabsContent
              value={4}
              className={cn(
                "min-h-0 min-w-0 flex-1 overflow-y-auto",
                fabClearance(mobile),
              )}
            >
              <ProcessAutomationsTab
                key={selectedProcessId}
                processId={selectedProcessId!}
                processName={workbenchProcessName}
                departmentName={workbenchDepartmentName}
                functionName={workbenchFunctionName}
                onOpenProcessFlow={handleOpenProcessFlow}
              />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );

  const mobilePreviewTitle =
    mobilePreview?.type === "function"
      ? "Function Overview"
      : mobilePreview?.type === "department"
        ? "Department Overview"
        : "Process Overview";
  const mobilePreviewDescription =
    mobilePreview?.type === "function"
      ? "An at-a-glance view of the departments and work in this function."
      : mobilePreview?.type === "department"
        ? "An at-a-glance view of the processes inside this department."
        : "The current process brief synthesized from captured conversations.";
  const mobilePreviewNavigateLabel =
    mobilePreview?.type === "function"
      ? "View departments"
      : mobilePreview?.type === "department"
        ? "View processes"
        : "Open process details";
  const handleMobilePreviewNavigate = () => {
    if (!mobilePreview) return;

    if (mobilePreview.type === "function") {
      setSelectedFunctionId(mobilePreview.id);
      setSelectedFunctionName(mobilePreview.name);
      setMobileLevel(2);
    } else if (mobilePreview.type === "department") {
      setSelectedDepartmentId(mobilePreview.id);
      setSelectedDepartmentName(mobilePreview.name);
      setMobileLevel(3);
    } else {
      setSelectedProcessId(mobilePreview.id);
      setSelectedProcessName(mobilePreview.name);
      setMobileLevel(4);
    }

    setMobilePreview(null);
  };

  return (
    <TooltipProvider>
      <div className="h-full bg-background">
        <ProcessAppShell onSearch={() => setPaletteOpen(true)}>
          {/* From `lg`: nested process tree + current workbench/detail
              surface. Below it, tablets join phones on the drill-down: the
              tree would leave the detail panel too little room, and its
              hover-only row actions don't work on touch. */}
          <div className="hidden min-w-0 flex-1 overflow-hidden lg:flex">
            <ProcessTreeNavigator
              tree={hierarchyTree}
              reveal={treeReveal}
              canEdit={canEdit}
              selectedFunctionId={selectedFunctionId}
              selectedDepartmentId={selectedDepartmentId}
              selectedProcessId={selectedProcessId}
              onSelectHome={handleSelectHome}
              onSelectFunction={handleTreeSelectFunction}
              onSelectDepartment={handleTreeSelectDepartment}
              onSelectProcess={handleTreeSelectProcess}
              onCreateFunction={() => openCrud("create", "Function")}
              onCreateDepartment={handleTreeCreateDepartment}
              onCreateProcess={handleTreeCreateProcess}
              onEditFunction={handleTreeEditFunction}
              onDeleteFunction={handleTreeDeleteFunction}
              onEditDepartment={handleTreeEditDepartment}
              onDeleteDepartment={handleTreeDeleteDepartment}
              onEditProcess={handleTreeEditProcess}
              onDeleteProcess={handleTreeDeleteProcess}
            />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              {detailPanel()}
            </div>
          </div>

          {/* Below `lg`: stacked single column */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden lg:hidden">
            {mobileLevel === 1 && mobileLandingColumn()}
            {mobileLevel === 2 && departmentsColumn()}
            {mobileLevel === 3 && processesColumn()}
            {mobileLevel === 4 && detailPanel(true)}
          </div>
        </ProcessAppShell>

        <Sheet
          open={!!mobilePreview}
          onOpenChange={(open) => {
            if (!open) setMobilePreview(null);
          }}
        >
          <SheetContent
            side="bottom"
            className="max-h-[82dvh] gap-0 overflow-hidden rounded-t-2xl p-0 sm:mx-auto sm:max-w-2xl"
          >
            <SheetHeader className="border-b p-5 pr-14">
              <div className="flex items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-org-accent-subtle text-org-accent">
                  {mobilePreview?.type === "function" ? (
                    <Building2 className="h-5 w-5" />
                  ) : mobilePreview?.type === "department" ? (
                    <Layers className="h-5 w-5" />
                  ) : (
                    <Cog className="h-5 w-5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate text-base">
                    {mobilePreview?.name}
                  </SheetTitle>
                  <SheetDescription className="truncate text-xs">
                    {mobilePreviewTitle}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {mobilePreviewDescription}
                </p>
              </div>

              {mobilePreview?.type === "process" ? (
                <ProcessOverviewCompactPreview
                  processId={mobilePreview.id}
                />
              ) : mobilePreview?.type === "department" ? (
                <HierarchyOverviewCompactPreview
                  entity={{
                    kind: "department",
                    departmentId: mobilePreview.id,
                  }}
                />
              ) : mobilePreview?.type === "function" ? (
                <HierarchyOverviewCompactPreview
                  entity={{ kind: "function", functionId: mobilePreview.id }}
                />
              ) : null}
            </div>

            <SheetFooter className="border-t p-4">
              <Button
                variant="outline"
                size="lg"
                className="min-h-12 w-full justify-between rounded-xl"
                onClick={handleMobilePreviewNavigate}
              >
                {mobilePreviewNavigateLabel}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        {/* CRUD Dialog */}
        {crudOpen && (
          <CrudDialog
            open={crudOpen}
            onOpenChange={setCrudOpen}
            mode={crudMode}
            entityType={crudEntity}
            currentName={crudTargetName}
            currentDescription={crudTargetDescription}
            currentLocationId={crudCurrentLocationId ?? undefined}
            locationOptions={
              crudMode === "edit" && crudEntity === "Department"
                ? departmentLocationOptions
                : crudMode === "edit" && crudEntity === "Process"
                  ? processLocationOptions
                  : undefined
            }
            locationLabel={
              crudEntity === "Department"
                ? "Function"
                : crudEntity === "Process"
                  ? "Department"
                  : undefined
            }
            deleteEligibility={
              crudMode === "delete" ? deleteEligibility : undefined
            }
            onCleanupChildren={
              crudMode === "delete" && crudEntity === "Process"
                ? handleOpenDeleteCleanup
                : undefined
            }
            onConfirm={handleCrudConfirm}
          />
        )}

        {/* Mounted once here, not in detailPanel(): the desktop and phone
            trees both render that panel, and a portaled dialog in each
            would open as two stacked copies. */}
        {canEdit && selectedProcessId && (
          <RecordingModal
            open={recordingOpen}
            onOpenChange={setRecordingOpen}
            processId={selectedProcessId}
            processName={workbenchProcessName}
            functionName={workbenchFunctionName}
            departmentName={workbenchDepartmentName}
            departmentDescription={safeDepartmentDescription}
            processDescription={safeProcessDescription}
            mode={recordingMode}
          />
        )}

        {/* Once, at the root: it portals, and the desktop and phone layouts
            are both mounted. It finds whichever capture control is visible. */}
        {canEdit &&
          captureHintProcessId !== null &&
          captureHintProcessId === selectedProcessId && (
            <Coachmark
              anchor="capture"
              side={isMobile ? "top" : "bottom"}
              title="Capture how this process works"
              body="Your first contribution turns into a process map. Start an AI interview, record a voice note, or upload a recording."
              onDismiss={dismissCaptureHint}
              // No capture control on screen: try again another time.
              onAnchorMissing={() => setCaptureHintProcessId(null)}
            />
          )}

        {tourActive && !isMobile && walkthroughStepList.length > 0 && (
          <Walkthrough
            key={tourRun}
            steps={walkthroughStepList}
            onSelect={selectAndReveal}
            onFinish={finishTour}
          />
        )}
        {tourActive && isMobile && (
          <ExploreSheet
            key={tourRun}
            open
            canCapture={canEdit}
            departmentName={myPlacement?.placement?.departmentName ?? null}
            onFinish={finishTour}
          />
        )}

        {/* ⌘K command palette — jump to any function/department/process */}
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          functions={functions ?? []}
          departments={allDepartments ?? []}
          processes={allProcesses ?? []}
          onJumpFunction={handleSelectFunction}
          onJumpDepartment={jumpToDepartment}
          onJumpProcess={jumpToProcess}
        />
      </div>
    </TooltipProvider>
  );
}
