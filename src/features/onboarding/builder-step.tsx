"use client";

import { useId, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ChevronDown } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ProcessTreeData } from "@/features/hierarchy/process-tree-navigator";
import {
  getCrudErrorMessage,
  withSaveTimeout,
} from "@/features/hierarchy/crud-dialog";
import type { RevealPath } from "@/features/workbench/reveal-path";
import {
  suggestDepartments,
  suggestFunctions,
  suggestProcesses,
} from "./builder-suggestions";
import { shouldPlaceInNewDepartment } from "./onboarding-view-model";

/** Matches the server's limit (convex/descriptionSafety.ts). */
const DESCRIPTION_MAX_LENGTH = 2000;
const MAX_CHIPS = 6;

export type BuilderKind = "function" | "department" | "process";

const COPY: Record<
  BuilderKind,
  { explainer: string; label: string; example: string; button: string }
> = {
  function: {
    explainer:
      "Functions are the top level of your organization, like Finance or Operations.",
    label: "Function name",
    example: "e.g. Finance",
    button: "Add function",
  },
  department: {
    explainer: "Departments are the teams inside a function.",
    label: "Department name",
    example: "e.g. Accounts Payable",
    button: "Add department",
  },
  process: {
    explainer:
      "A process is a piece of work a team does, like approving invoices. Once it's added, your team can capture how it gets done.",
    label: "Process name",
    example: "e.g. Invoice approval",
    button: "Add process",
  },
};

type ParentOption = { value: string; label: string; group?: string };

function parentOptions(tree: ProcessTreeData, kind: BuilderKind): ParentOption[] {
  if (kind === "department") {
    return tree.functions.map((fn) => ({ value: fn._id, label: fn.name }));
  }
  if (kind === "process") {
    return tree.functions.flatMap((fn) =>
      fn.departments.map((department) => ({
        value: department._id,
        label: department.name,
        group: fn.name,
      })),
    );
  }
  return [];
}

type BuilderStepProps = {
  kind: BuilderKind;
  tree: ProcessTreeData;
  /** The parent to start with: usually the one just created. */
  defaultParentId?: string | null;
  /** After a successful create, with the new node's whole path. */
  onCreated: (path: RevealPath) => void;
};

/** One Getting started step: name the next function, department or process,
 * with suggestions, and create it through the same endpoints as the tree's
 * dialog. */
export function BuilderStep({
  kind,
  tree,
  defaultParentId,
  onCreated,
}: BuilderStepProps) {
  const fieldId = useId();
  const createFunction = useMutation(api.functions.create);
  const createDepartment = useAction(api.departments.create);
  const createProcess = useAction(api.processes.create);
  const setMyPlacement = useMutation(api.users.setMyPlacement);
  const placement = useQuery(
    api.users.getMyPlacement,
    kind === "department" ? {} : "skip",
  );

  const options = parentOptions(tree, kind);
  const fallbackParent =
    options.find((option) => option.value === defaultParentId)?.value ??
    options[0]?.value ??
    "";
  const [chosenParent, setChosenParent] = useState<string | null>(null);
  // A parent deleted by someone else falls back to the default.
  const parentId =
    chosenParent && options.some((option) => option.value === chosenParent)
      ? chosenParent
      : fallbackParent;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [placeHere, setPlaceHere] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const parentFunction =
    kind === "department"
      ? tree.functions.find((fn) => fn._id === parentId)
      : undefined;
  const parentDepartmentEntry =
    kind === "process"
      ? tree.functions
          .flatMap((fn) => fn.departments.map((department) => ({ fn, department })))
          .find(({ department }) => department._id === parentId)
      : undefined;

  const suggestions = (
    kind === "function"
      ? suggestFunctions(tree.functions.map((fn) => fn.name))
      : kind === "department"
        ? parentFunction
          ? suggestDepartments(
              parentFunction.name,
              parentFunction.departments.map((department) => department.name),
            )
          : []
        : parentDepartmentEntry
          ? suggestProcesses(
              parentDepartmentEntry.department.name,
              parentDepartmentEntry.department.processes.map((process) => process.name),
            )
          : []
  ).slice(0, MAX_CHIPS);

  // Offered only to someone the box could actually place.
  const canPlace =
    kind === "department" && shouldPlaceInNewDepartment(true, placement);
  const needsParent = kind !== "function";
  const copy = COPY[kind];

  const create = async (): Promise<RevealPath | null> => {
    const trimmed = name.trim();
    const context = description.trim() || undefined;
    if (kind === "function") {
      const functionId = await withSaveTimeout(createFunction({ name: trimmed }));
      return { kind: "function", functionId, functionName: trimmed };
    }
    if (kind === "department" && parentFunction) {
      const departmentId = await withSaveTimeout(
        createDepartment({
          functionId: parentFunction._id,
          name: trimmed,
          description: context,
        }),
      );
      return {
        kind: "department",
        functionId: parentFunction._id,
        functionName: parentFunction.name,
        departmentId,
        departmentName: trimmed,
      };
    }
    if (kind === "process" && parentDepartmentEntry) {
      const { fn, department } = parentDepartmentEntry;
      const processId = await withSaveTimeout(
        createProcess({
          departmentId: department._id,
          name: trimmed,
          description: context,
        }),
      );
      return {
        kind: "process",
        functionId: fn._id,
        functionName: fn.name,
        departmentId: department._id,
        departmentName: department.name,
        processId,
        processName: trimmed,
      };
    }
    return null;
  };

  const submit = async () => {
    if (saving || !name.trim()) return;
    if (description.length > DESCRIPTION_MAX_LENGTH) return;
    setSaving(true);
    setError("");
    try {
      const path = await create();
      if (!path) {
        setError("Choose where this goes first.");
        return;
      }
      if (
        path.kind === "department" &&
        shouldPlaceInNewDepartment(placeHere, placement)
      ) {
        // Best effort: the department exists either way, and an admin can
        // place them from Admin → Users.
        await setMyPlacement({ departmentId: path.departmentId }).catch(
          (err: unknown) => console.warn("Couldn't set your department", err),
        );
      }
      setName("");
      setDescription("");
      setContextOpen(false);
      onCreated(path);
    } catch (err) {
      setError(getCrudErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const itemsMap = Object.fromEntries(
    options.map((option) => [option.value, option.label]),
  );
  const groups = kind === "process"
    ? Array.from(
        options.reduce((map, option) => {
          const list = map.get(option.group ?? "") ?? [];
          list.push(option);
          return map.set(option.group ?? "", list);
        }, new Map<string, ParentOption[]>()),
      )
    : null;

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="text-sm leading-6 text-muted-foreground">{copy.explainer}</p>

      {needsParent && options.length > 1 && (
        <div className="space-y-1.5">
          <p id={`${fieldId}-parent`} className="text-sm font-medium">
            {kind === "department" ? "In function" : "In department"}
          </p>
          <Select
            value={parentId}
            onValueChange={(value) => setChosenParent(value as string)}
            items={itemsMap}
          >
            <SelectTrigger className="w-full" aria-labelledby={`${fieldId}-parent`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {groups
                ? groups.map(([group, items]) => (
                    <SelectGroup key={group}>
                      <SelectLabel>{group}</SelectLabel>
                      {items.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))
                : options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor={`${fieldId}-name`} className="text-sm font-medium">
          {copy.label}
          {needsParent && options.length === 1 && (
            <span className="font-normal text-muted-foreground">
              {" "}
              in {options[0].label}
            </span>
          )}
        </label>
        <Input
          id={`${fieldId}-name`}
          value={name}
          placeholder={copy.example}
          maxLength={120}
          onChange={(event) => {
            setName(event.target.value);
            setError("");
          }}
        />
      </div>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Suggestions">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className={cn(
                "org-focus-ring rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-org-accent-subtle motion-reduce:transition-none",
                name === suggestion && "border-org-accent-border bg-org-accent-subtle",
              )}
              aria-pressed={name === suggestion}
              onClick={() => {
                setName(suggestion);
                setError("");
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {needsParent && (
        <div>
          <button
            type="button"
            className="org-focus-ring inline-flex items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground"
            aria-expanded={contextOpen}
            onClick={() => setContextOpen((open) => !open)}
          >
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform motion-reduce:transition-none",
                contextOpen && "rotate-180",
              )}
              aria-hidden="true"
            />
            Add context for the AI interviewer
          </button>
          {contextOpen && (
            <div className="mt-2 space-y-1">
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={`What should the interviewer know about this ${kind}? Optional.`}
                aria-label={`Context for the AI interviewer about this ${kind}`}
                rows={3}
              />
              <p
                className={cn(
                  "text-right text-xs tabular-nums",
                  description.length > DESCRIPTION_MAX_LENGTH
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {description.length} / {DESCRIPTION_MAX_LENGTH}
              </p>
            </div>
          )}
        </div>
      )}

      {canPlace && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={placeHere}
            onCheckedChange={(checked) => setPlaceHere(checked === true)}
          />
          I work in this department
        </label>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button
        type="submit"
        disabled={
          saving ||
          !name.trim() ||
          description.length > DESCRIPTION_MAX_LENGTH ||
          (needsParent && !parentId)
        }
      >
        {saving ? "Saving…" : copy.button}
      </Button>
    </form>
  );
}
