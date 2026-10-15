"use client";

import { useState } from "react";
import { useClerk, useUser } from "@clerk/nextjs";
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
import { describeError } from "@/lib/user-error-message";

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

function splitName(fullName: string) {
  const [firstName, ...rest] = fullName.trim().split(/\s+/);
  return { firstName: firstName ?? "", lastName: rest.join(" ") };
}

export function ProfileOnboarding({ mode, askPlacement }: ProfileOnboardingProps) {
  const { user: clerkUser } = useUser();
  const { signOut } = useClerk();
  const completeProfile = useMutation(api.users.completeProfile);
  const setMyPlacement = useMutation(api.users.setMyPlacement);
  const skipMyPlacement = useMutation(api.users.skipMyPlacement);
  const functions = useQuery(api.functions.list, askPlacement ? {} : "skip");

  const clerkName = [clerkUser?.firstName, clerkUser?.lastName]
    .filter(Boolean)
    .join(" ");
  // Starts from the sign-in account's name; null until the person edits it,
  // so a Clerk profile that loads late still fills the field.
  const [editedName, setEditedName] = useState<string | null>(null);
  const name = editedName ?? clerkName;
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
  const functionHasNoDepartments =
    selectedFunctionId !== "" && departments !== undefined && departments.length === 0;

  /** Keeps the sign-in account's name in step, so the next sign-in doesn't
   * put the old one back. Best effort: Fabric saves the name either way. */
  const syncClerkName = async (fullName: string) => {
    if (!clerkUser || fullName === clerkName) return;
    try {
      await clerkUser.update(splitName(fullName));
    } catch (err) {
      console.warn("Couldn't update the sign-in account's name", err);
    }
  };

  const submit = async (skipPlacement: boolean) => {
    setError("");

    const missingPlacement =
      askPlacement && !skipPlacement && !selectedDepartmentId;
    const missingProfile =
      mode === "profile" && (!name.trim() || !jobTitle.trim() || !hireDate);
    if (missingProfile) {
      setError("Enter your name, job title and hire date.");
      return;
    }
    if (missingPlacement) {
      setError(
        "Choose your department, or select “Not sure” to skip this for now.",
      );
      return;
    }

    setLoading(true);
    try {
      if (mode === "placement") {
        if (skipPlacement) {
          await skipMyPlacement({});
        } else {
          await setMyPlacement({
            departmentId: selectedDepartmentId as Id<"departments">,
          });
        }
      } else {
        await syncClerkName(name.trim());
        await completeProfile({
          name: name.trim(),
          jobTitle: jobTitle.trim(),
          hireDate,
          ...(!skipPlacement && selectedDepartmentId
            ? { departmentId: selectedDepartmentId }
            : {}),
          ...(askPlacement && skipPlacement ? { skipPlacement: true } : {}),
        });
      }
    } catch (err) {
      setError(describeError(err, "Something went wrong. Please try again."));
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
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit(false);
            }}
            className="space-y-4"
          >
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
                    autoComplete="name"
                    placeholder="e.g., Sara Ahmed"
                    value={name}
                    onChange={(e) => setEditedName(e.target.value)}
                    maxLength={120}
                    required
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
                    maxLength={120}
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
                  >
                    <option value="">Select a function…</option>
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
                    disabled={!selectedFunctionId || functionHasNoDepartments}
                    aria-describedby={
                      functionHasNoDepartments ? "department-empty" : undefined
                    }
                  >
                    <option value="">
                      {!selectedFunctionId
                        ? "Select a function first"
                        : functionHasNoDepartments
                          ? "No departments yet"
                          : "Select a department…"}
                    </option>
                    {departments?.map((dept) => (
                      <option key={dept._id} value={dept._id}>
                        {dept.name}
                      </option>
                    ))}
                  </select>
                  {functionHasNoDepartments && (
                    <p
                      id="department-empty"
                      className="text-xs text-muted-foreground"
                    >
                      This function has no departments yet. Pick another
                      function, or choose &ldquo;Not sure&rdquo; below.
                    </p>
                  )}
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

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="space-y-2">
              <Button type="submit" className="w-full" disabled={loading}>
                {loading
                  ? "Saving…"
                  : mode === "profile"
                    ? "Complete Profile"
                    : "Continue"}
              </Button>
              {askPlacement && (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  disabled={loading}
                  onClick={() => void submit(true)}
                >
                  Not sure where I sit. Skip for now
                </Button>
              )}
            </div>
            {askPlacement && (
              <p className="text-center text-xs text-muted-foreground">
                If you skip, an admin can place you later.
              </p>
            )}
          </form>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Not you, or in the wrong workspace?{" "}
            <button
              type="button"
              className="rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => void signOut({ redirectUrl: "/sign-in" })}
            >
              Sign out
            </button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
