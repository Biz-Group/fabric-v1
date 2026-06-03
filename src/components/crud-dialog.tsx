"use client";

import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  SelectValue,
} from "@/components/ui/select";

type CrudMode = "create" | "edit" | "delete";
const SAVE_TIMEOUT_MS = 45000;

type DeleteEligibility = {
  canDelete: boolean;
  blocker: "role" | "children" | null;
  childKind: "departments" | "processes" | "conversations" | null;
  canCleanUpChildren: boolean;
};

export interface LocationOption {
  value: string;
  label: string;
  group?: string;
}

interface CrudDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: CrudMode;
  entityType: string; // "Function" | "Department" | "Process"
  currentName?: string;
  currentDescription?: string;
  currentLocationId?: string;
  locationOptions?: LocationOption[];
  locationLabel?: string;
  /** Server-computed delete state. undefined = still loading. */
  deleteEligibility?: DeleteEligibility;
  onCleanupChildren?: () => void;
  onConfirm: (
    name: string,
    newLocationId?: string,
    description?: string
  ) => Promise<void>;
}

function getErrorData(err: unknown): Record<string, unknown> | null {
  if (!err || typeof err !== "object" || !("data" in err)) return null;
  const data = (err as { data?: unknown }).data;
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

function getCrudErrorMessage(err: unknown): string {
  const data = getErrorData(err);
  if (typeof data?.userMessage === "string") return data.userMessage;

  const message = err instanceof Error ? err.message : "";

  if (message.includes("Description safety check")) {
    return "The description could not be checked right now. Please try again.";
  }
  if (message.includes("Safety check returned")) {
    return "The description could not be checked right now. Please try again.";
  }
  if (message.includes("Descriptions cannot include hidden or control characters")) {
    return "Descriptions cannot include hidden or control characters.";
  }
  if (message.includes("Descriptions must be")) {
    return "Descriptions must be 2000 characters or fewer.";
  }
  if (message.includes("Description was blocked")) {
    return "This description could not be saved because it appears to contain instructions for the AI interviewer, policy changes, or sensitive-data requests. Remove those parts and try again.";
  }

  const uncaughtMessage = message.match(/Uncaught (?:Error|ConvexError): ([^\n]+)/);
  if (uncaughtMessage?.[1]) return uncaughtMessage[1];

  return message || "Something went wrong.";
}

function withSaveTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(
        new Error(
          "Saving took too long. Please check your connection and try again.",
        ),
      );
    }, SAVE_TIMEOUT_MS);

    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (reason) => {
        window.clearTimeout(timeoutId);
        reject(reason);
      },
    );
  });
}

export function CrudDialog({
  open,
  onOpenChange,
  mode,
  entityType,
  currentName,
  currentDescription,
  currentLocationId,
  locationOptions,
  locationLabel,
  deleteEligibility,
  onCleanupChildren,
  onConfirm,
}: CrudDialogProps) {
  const [name, setName] = useState(mode === "edit" ? currentName ?? "" : "");
  const [description, setDescription] = useState(
    mode === "edit" ? currentDescription ?? "" : ""
  );
  const [selectedLocationId, setSelectedLocationId] = useState<
    string | undefined
  >(mode === "edit" ? currentLocationId : undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (mode !== "delete" && !name.trim()) return;
    if (description.length > 2000) return;
    setLoading(true);
    setError(null);
    try {
      await withSaveTimeout(onConfirm(name.trim(), selectedLocationId, description));
      onOpenChange(false);
    } catch (err) {
      setError(getCrudErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const showLocation =
    mode === "edit" && locationOptions && locationOptions.length > 0;
  const showDescription =
    mode !== "delete" &&
    (entityType === "Department" || entityType === "Process");
  const descriptionOverLimit = description.length > 2000;
  const deleteLoading = mode === "delete" && deleteEligibility === undefined;
  const deleteBlocked =
    mode === "delete" && deleteEligibility !== undefined && !deleteEligibility.canDelete;
  const deleteChildKind = deleteEligibility?.childKind;

  const hasGroups = locationOptions?.some((opt) => opt.group);
  const groupedOptions = useMemo(() => {
    if (!hasGroups || !locationOptions) return [];
    const groups: Record<string, LocationOption[]> = {};
    for (const opt of locationOptions) {
      const group = opt.group ?? "Other";
      (groups[group] ??= []).push(opt);
    }
    return Object.entries(groups);
  }, [hasGroups, locationOptions]);

  // Build items map for SelectValue to display label instead of raw ID
  const itemsMap = useMemo(() => {
    if (!locationOptions) return undefined;
    const map: Record<string, string> = {};
    for (const opt of locationOptions) {
      map[opt.value] = opt.label;
    }
    return map;
  }, [locationOptions]);

  const title =
    mode === "create"
      ? `Add ${entityType}`
      : mode === "edit"
        ? `Edit ${entityType}`
        : `Delete ${entityType}`;
  const childLabel =
    deleteChildKind === "departments"
      ? "departments"
      : deleteChildKind === "processes"
        ? "processes"
        : "conversations";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {mode === "delete" ? (
            <DialogDescription>
              {deleteLoading ? (
                <>Checking whether <strong>{currentName}</strong> can be deleted...</>
              ) : deleteEligibility?.blocker === "role" ? (
                <>
                  You need contributor or admin access to delete{" "}
                  <strong>{currentName}</strong>.
                </>
              ) : deleteEligibility?.blocker === "children" ? (
                <>
                  <strong>{currentName}</strong> cannot be deleted because it has{" "}
                  {childLabel}.{" "}
                  {deleteChildKind === "conversations"
                    ? deleteEligibility.canCleanUpChildren
                      ? "Delete those conversations from Admin > Conversations first, then try again."
                      : "Ask a workspace admin to delete those conversations first."
                    : "Remove all child items first."}
                </>
              ) : (
                <>
                  Are you sure you want to delete <strong>{currentName}</strong>?
                  This action cannot be undone.
                </>
              )}
            </DialogDescription>
          ) : (
            <DialogDescription>
              {mode === "create"
                ? `Enter a name for the new ${entityType.toLowerCase()}.`
                : `Update the name${showLocation ? " or location" : ""} of this ${entityType.toLowerCase()}.`}
            </DialogDescription>
          )}
        </DialogHeader>

        {mode !== "delete" && (
          <div className="space-y-3 py-2">
            <div>
              <Input
                placeholder={`${entityType} name`}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
                }}
                autoFocus
              />
            </div>

            {showLocation && (
              <div>
                <p className="mb-1.5 text-sm font-medium text-foreground">
                  {locationLabel ?? "Location"}
                </p>
                <Select
                  value={selectedLocationId}
                  onValueChange={(val) => {
                    setSelectedLocationId(val as string);
                    setError(null);
                  }}
                  items={itemsMap}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={`Select ${(locationLabel ?? "location").toLowerCase()}`}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {hasGroups
                      ? groupedOptions.map(([groupName, items]) => (
                          <SelectGroup key={groupName}>
                            <SelectLabel>{groupName}</SelectLabel>
                            {items.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ))
                      : (locationOptions ?? []).map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {showDescription && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">
                    Description
                  </p>
                  <p
                    className={
                      descriptionOverLimit
                        ? "text-xs text-destructive"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    {description.length}/2000
                  </p>
                </div>
                <Textarea
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setError(null);
                  }}
                  placeholder={`Context to help the AI interviewer understand this ${entityType.toLowerCase()}`}
                  className="max-h-40 min-h-24 resize-y"
                />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Saved descriptions are checked before they can be used as AI
                  interview context.
                </p>
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <DialogFooter>
          {mode === "delete" &&
            deleteChildKind === "conversations" &&
            deleteEligibility?.canCleanUpChildren &&
            onCleanupChildren && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onCleanupChildren}
                disabled={loading}
              >
                Open conversations
              </Button>
            )}
          <DialogClose render={<Button variant="outline" size="sm" />}>
            Cancel
          </DialogClose>
          <Button
            size="sm"
            variant={mode === "delete" ? "destructive" : "default"}
            disabled={
              loading ||
              descriptionOverLimit ||
              (mode === "delete" && (deleteLoading || deleteBlocked)) ||
              (mode !== "delete" && !name.trim())
            }
            onClick={handleSubmit}
          >
            {loading
              ? "Saving..."
              : mode === "create"
                ? "Create"
                : mode === "edit"
                  ? "Save"
                  : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
