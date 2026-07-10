"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ProfileDraft = {
  name: string;
  jobTitle: string;
  functionName: string;
  department: string;
  hireDate: string;
};

export function ProfileEditDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const user = useQuery(api.users.getMe);
  const updateProfile = useMutation(api.users.updateProfile);

  const userValues = useMemo<ProfileDraft>(
    () => ({
      name: user?.name ?? "",
      jobTitle: user?.jobTitle ?? "",
      functionName: user?.function ?? "",
      department: user?.department ?? "",
      hireDate: user?.hireDate ?? "",
    }),
    [user],
  );
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const form = draft ?? userValues;

  const updateDraft = (field: keyof ProfileDraft, value: string) => {
    setDraft({ ...form, [field]: value });
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setDraft(null);
    onOpenChange(nextOpen);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await updateProfile({
        name: form.name.trim(),
        jobTitle: form.jobTitle.trim(),
        function: form.functionName.trim(),
        department: form.department.trim(),
        hireDate: form.hireDate,
      });
      handleOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save your profile.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Profile</DialogTitle>
          <DialogDescription>
            Update your profile information.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="edit-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="edit-name"
              value={form.name}
              onChange={(e) => updateDraft("name", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="edit-jobTitle" className="text-sm font-medium">
              Job Title
            </label>
            <Input
              id="edit-jobTitle"
              value={form.jobTitle}
              onChange={(e) => updateDraft("jobTitle", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="edit-function" className="text-sm font-medium">
              Function
            </label>
            <Input
              id="edit-function"
              value={form.functionName}
              onChange={(e) => updateDraft("functionName", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="edit-department" className="text-sm font-medium">
              Department
            </label>
            <Input
              id="edit-department"
              value={form.department}
              onChange={(e) => updateDraft("department", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="edit-hireDate" className="text-sm font-medium">
              Hire Date
            </label>
            <Input
              id="edit-hireDate"
              type="date"
              value={form.hireDate}
              onChange={(e) => updateDraft("hireDate", e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
