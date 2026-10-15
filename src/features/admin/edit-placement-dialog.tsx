"use client";

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { describeError } from "@/lib/user-error-message";

export type DepartmentOption = {
  _id: Id<"departments">;
  name: string;
  functionName: string;
};

export type PlacementMember = {
  membershipId: Id<"memberships">;
  name: string;
  email: string;
  departmentId: Id<"departments"> | null;
  jobTitleOverride: string | null;
  /** The title the member entered themselves. */
  profileJobTitle: string | null;
};

const UNPLACED = "unplaced";

/** Departments grouped under their function, in the order given. */
export function groupDepartments(departments: DepartmentOption[]) {
  const groups = new Map<string, DepartmentOption[]>();
  for (const department of departments) {
    const group = groups.get(department.functionName) ?? [];
    group.push(department);
    groups.set(department.functionName, group);
  }
  return [...groups.entries()];
}

export function EditPlacementDialog({
  member,
  departments,
  onOpenChange,
}: {
  /** The member being edited; null closes the dialog. */
  member: PlacementMember | null;
  departments: DepartmentOption[] | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {member && (
          // Keyed so the form starts from this member's values each time.
          <PlacementForm
            key={member.membershipId}
            member={member}
            departments={departments}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PlacementForm({
  member,
  departments,
  onDone,
}: {
  member: PlacementMember;
  departments: DepartmentOption[] | undefined;
  onDone: () => void;
}) {
  const updatePlacement = useMutation(api.users.updateMemberPlacement);
  const [departmentId, setDepartmentId] = useState<string>(
    member.departmentId ?? UNPLACED,
  );
  const [jobTitle, setJobTitle] = useState(
    member.jobTitleOverride ?? member.profileJobTitle ?? "",
  );
  const [saving, setSaving] = useState(false);

  const groups = useMemo(() => groupDepartments(departments ?? []), [
    departments,
  ]);
  const items = useMemo<Record<string, string>>(
    () => ({
      [UNPLACED]: "Not placed",
      ...Object.fromEntries(
        (departments ?? []).map((department) => [
          department._id,
          `${department.name} · ${department.functionName}`,
        ]),
      ),
    }),
    [departments],
  );

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await updatePlacement({
        membershipId: member.membershipId,
        departmentId:
          departmentId === UNPLACED
            ? null
            : (departmentId as Id<"departments">),
        jobTitle,
      });
      toast.success(`Updated ${member.name}'s placement.`);
      onDone();
    } catch (err) {
      toast.error(describeError(err, "Failed to update placement."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
      className="contents"
    >
      <DialogHeader>
        <DialogTitle>Edit placement</DialogTitle>
        <DialogDescription>
          Where {member.name} sits in this workspace. Changes apply here only.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2">
        <div className="space-y-1">
          <p className="text-sm font-medium">{member.name}</p>
          <p className="text-xs text-muted-foreground">
            {member.email ? `${member.email} · ` : ""}
            The name comes from their sign-in account.
          </p>
        </div>

        <div className="space-y-1.5">
          <p id="placement-department-label" className="text-sm font-medium">
            Department
          </p>
          <Select
            value={departmentId}
            items={items}
            onValueChange={(value) => setDepartmentId(value as string)}
            disabled={saving || departments === undefined}
          >
            <SelectTrigger
              className="w-full"
              aria-labelledby="placement-department-label"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNPLACED}>Not placed</SelectItem>
              {groups.map(([functionName, options]) => (
                <SelectGroup key={functionName}>
                  <SelectLabel>{functionName}</SelectLabel>
                  {options.map((option) => (
                    <SelectItem key={option._id} value={option._id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="placement-job-title" className="text-sm font-medium">
            Job title
          </label>
          <Input
            id="placement-job-title"
            value={jobTitle}
            onChange={(event) => setJobTitle(event.target.value)}
            placeholder={member.profileJobTitle ?? "No job title"}
            maxLength={120}
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">
            {member.profileJobTitle
              ? `Leave blank to use the title they entered: ${member.profileJobTitle}.`
              : "Leave blank to show no title."}
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onDone}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
