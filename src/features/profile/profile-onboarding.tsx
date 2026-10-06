"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Id } from "../../../convex/_generated/dataModel";

const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

type ProfileOnboardingProps = {
  /** "profile" collects the global profile (and placement, when the org has a
   * hierarchy). "placement" is for members whose profile is already complete
   * — e.g. from another org — but who have no department in this org. */
  mode: "profile" | "placement";
  /** Whether this org has departments to choose from. */
  askPlacement: boolean;
};

export function ProfileOnboarding({ mode, askPlacement }: ProfileOnboardingProps) {
  const { user: clerkUser } = useUser();
  const completeProfile = useMutation(api.users.completeProfile);
  const setMyPlacement = useMutation(api.users.setMyPlacement);
  const functions = useQuery(api.functions.list, askPlacement ? {} : "skip");

  const clerkName = [clerkUser?.firstName, clerkUser?.lastName]
    .filter(Boolean)
    .join(" ") || "Anonymous";
  const [jobTitle, setJobTitle] = useState("");
  const [selectedFunctionId, setSelectedFunctionId] =
    useState<Id<"functions"> | "">("");
  const [selectedDepartmentId, setSelectedDepartmentId] =
    useState<Id<"departments"> | "">("");
  const [hireDate, setHireDate] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const departments = useQuery(
    api.departments.listByFunction,
    selectedFunctionId ? { functionId: selectedFunctionId } : "skip",
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const missingPlacement = askPlacement && !selectedDepartmentId;
    const missingProfile =
      mode === "profile" && (!jobTitle.trim() || !hireDate);
    if (missingPlacement || missingProfile) {
      setError("All fields are required.");
      return;
    }

    setLoading(true);
    try {
      if (mode === "placement") {
        await setMyPlacement({
          departmentId: selectedDepartmentId as Id<"departments">,
        });
      } else {
        await completeProfile({
          name: clerkName,
          jobTitle: jobTitle.trim(),
          hireDate,
          ...(selectedDepartmentId ? { departmentId: selectedDepartmentId } : {}),
        });
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold tracking-tight">
            {mode === "profile" ? "Welcome to Fabric." : "Where do you sit?"}
          </CardTitle>
          <CardDescription>
            {mode === "profile"
              ? "Complete your profile to get started. This helps us personalize your experience."
              : "Choose your function and department in this organization."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "profile" && (
              <>
                <div className="space-y-2">
                  <label
                    htmlFor="name"
                    className="text-sm font-medium leading-none"
                  >
                    Full Name
                  </label>
                  <Input
                    id="name"
                    type="text"
                    value={clerkName}
                    disabled
                    className="disabled:opacity-70"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="jobTitle"
                    className="text-sm font-medium leading-none"
                  >
                    Job Title
                  </label>
                  <Input
                    id="jobTitle"
                    type="text"
                    placeholder="e.g., Payroll Manager"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    required
                  />
                </div>
              </>
            )}

            {askPlacement && (
              <>
                <div className="space-y-2">
                  <label
                    htmlFor="function"
                    className="text-sm font-medium leading-none"
                  >
                    Function
                  </label>
                  <select
                    id="function"
                    className={selectClassName}
                    value={selectedFunctionId}
                    onChange={(e) => {
                      setSelectedFunctionId(e.target.value as Id<"functions"> | "");
                      setSelectedDepartmentId("");
                    }}
                    required
                  >
                    <option value="">Select a function...</option>
                    {functions?.map((fn) => (
                      <option key={fn._id} value={fn._id}>
                        {fn.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="department"
                    className="text-sm font-medium leading-none"
                  >
                    Department
                  </label>
                  <select
                    id="department"
                    className={selectClassName}
                    value={selectedDepartmentId}
                    onChange={(e) =>
                      setSelectedDepartmentId(
                        e.target.value as Id<"departments"> | "",
                      )
                    }
                    required
                    disabled={!selectedFunctionId}
                  >
                    <option value="">
                      {selectedFunctionId
                        ? "Select a department..."
                        : "Select a function first"}
                    </option>
                    {departments?.map((dept) => (
                      <option key={dept._id} value={dept._id}>
                        {dept.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {mode === "profile" && (
              <div className="space-y-2">
                <label
                  htmlFor="hireDate"
                  className="text-sm font-medium leading-none"
                >
                  Hire Date
                </label>
                <Input
                  id="hireDate"
                  type="date"
                  value={hireDate}
                  onChange={(e) => setHireDate(e.target.value)}
                  required
                />
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading
                ? "Saving..."
                : mode === "profile"
                  ? "Complete Profile"
                  : "Continue"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
