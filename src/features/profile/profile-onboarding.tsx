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
import { cn } from "@/lib/utils";

const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-ring disabled:cursor-not-allowed disabled:opacity-50";

const MISSING_PLACEMENT =
  "Choose your department, or select “Not sure” to skip this for now.";

function splitName(fullName: string) {
  const [firstName, ...rest] = fullName.trim().split(/\s+/);
  return { firstName: firstName ?? "", lastName: rest.join(" ") };
}

/** The function and department pickers' state. Functions load only when
 * `enabled`, since an org without departments never asks. */
function usePlacementChoice(enabled: boolean) {
  const functions = useQuery(api.functions.list, enabled ? {} : "skip");
  const [functionId, setFunctionId] = useState<Id<"functions"> | "">("");
  const [departmentId, setDepartmentId] = useState<Id<"departments"> | "">(
    "",
  );
  const departments = useQuery(
    api.departments.listByFunction,
    functionId ? { functionId } : "skip",
  );
  return {
    functions,
    departments,
    functionId,
    departmentId,
    functionHasNoDepartments:
      functionId !== "" && departments !== undefined && departments.length === 0,
    chooseFunction: (id: Id<"functions"> | "") => {
      setFunctionId(id);
      setDepartmentId("");
    },
    chooseDepartment: setDepartmentId,
  };
}

type PlacementChoice = ReturnType<typeof usePlacementChoice>;

function PlacementSelects({ choice }: { choice: PlacementChoice }) {
  return (
    <>
      <div className="space-y-2">
        <label htmlFor="function" className="text-sm font-medium leading-none">
          Function
        </label>
        <select
          id="function"
          className={selectClassName}
          value={choice.functionId}
          onChange={(e) =>
            choice.chooseFunction(e.target.value as Id<"functions"> | "")
          }
        >
          <option value="">Select a function…</option>
          {choice.functions?.map((fn) => (
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
          value={choice.departmentId}
          onChange={(e) =>
            choice.chooseDepartment(e.target.value as Id<"departments"> | "")
          }
          disabled={!choice.functionId || choice.functionHasNoDepartments}
          aria-describedby={
            choice.functionHasNoDepartments ? "department-empty" : undefined
          }
        >
          <option value="">
            {!choice.functionId
              ? "Select a function first"
              : choice.functionHasNoDepartments
                ? "No departments yet"
                : "Select a department…"}
          </option>
          {choice.departments?.map((dept) => (
            <option key={dept._id} value={dept._id}>
              {dept.name}
            </option>
          ))}
        </select>
        {choice.functionHasNoDepartments && (
          <p id="department-empty" className="text-xs text-muted-foreground">
            This function has no departments yet. Pick another function, or
            choose &ldquo;Not sure&rdquo; below.
          </p>
        )}
      </div>
    </>
  );
}

/** Submit, plus the "Not sure" skip when placement is asked. */
function FormActions({
  loading,
  submitLabel,
  askPlacement,
  onSkip,
}: {
  loading: boolean;
  submitLabel: string;
  askPlacement: boolean;
  onSkip: () => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Saving…" : submitLabel}
        </Button>
        {askPlacement && (
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={loading}
            onClick={onSkip}
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
    </>
  );
}

function FormError({ error }: { error: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  );
}

type ProfileFieldsProps = {
  /** Also ask for a department in the same form (the org has some). */
  askPlacement: boolean;
  submitLabel: string;
  /** After a successful save. The profile query moves on by itself either
   * way; a stepped flow uses this to advance. */
  onDone?: () => void;
};

/** The global profile: name (prefilled from the sign-in account and written
 * back to it), job title and hire date, optionally with this org's
 * placement. */
export function ProfileFields({
  askPlacement,
  submitLabel,
  onDone,
}: ProfileFieldsProps) {
  const { user: clerkUser } = useUser();
  const completeProfile = useMutation(api.users.completeProfile);
  const choice = usePlacementChoice(askPlacement);

  const clerkName = [clerkUser?.firstName, clerkUser?.lastName]
    .filter(Boolean)
    .join(" ");
  // Starts from the sign-in account's name; null until the person edits it,
  // so a Clerk profile that loads late still fills the field.
  const [editedName, setEditedName] = useState<string | null>(null);
  const name = editedName ?? clerkName;
  const [jobTitle, setJobTitle] = useState("");
  const [hireDate, setHireDate] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
    if (!name.trim() || !jobTitle.trim() || !hireDate) {
      setError("Enter your name, job title and hire date.");
      return;
    }
    if (askPlacement && !skipPlacement && !choice.departmentId) {
      setError(MISSING_PLACEMENT);
      return;
    }

    setLoading(true);
    try {
      await syncClerkName(name.trim());
      await completeProfile({
        name: name.trim(),
        jobTitle: jobTitle.trim(),
        hireDate,
        ...(askPlacement && !skipPlacement && choice.departmentId
          ? { departmentId: choice.departmentId }
          : {}),
        ...(askPlacement && skipPlacement ? { skipPlacement: true } : {}),
      });
      onDone?.();
    } catch (err) {
      setError(describeError(err, "Something went wrong. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit(false);
      }}
      className="space-y-4"
    >
      <div className="space-y-2">
        <label htmlFor="name" className="text-sm font-medium leading-none">
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
        <label htmlFor="jobTitle" className="text-sm font-medium leading-none">
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

      {askPlacement && <PlacementSelects choice={choice} />}

      <div className="space-y-2">
        <label htmlFor="hireDate" className="text-sm font-medium leading-none">
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

      <FormError error={error} />
      <FormActions
        loading={loading}
        submitLabel={submitLabel}
        askPlacement={askPlacement}
        onSkip={() => void submit(true)}
      />
    </form>
  );
}

/** This org's placement alone, for members whose profile is already
 * complete. "Not sure" records a skip so they aren't asked again. */
export function PlacementFields({
  submitLabel,
  onDone,
}: {
  submitLabel: string;
  onDone?: () => void;
}) {
  const setMyPlacement = useMutation(api.users.setMyPlacement);
  const skipMyPlacement = useMutation(api.users.skipMyPlacement);
  const choice = usePlacementChoice(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (skip: boolean) => {
    setError("");
    if (!skip && !choice.departmentId) {
      setError(MISSING_PLACEMENT);
      return;
    }
    setLoading(true);
    try {
      if (skip) {
        await skipMyPlacement({});
      } else {
        await setMyPlacement({
          departmentId: choice.departmentId as Id<"departments">,
        });
      }
      onDone?.();
    } catch (err) {
      setError(describeError(err, "Something went wrong. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit(false);
      }}
      className="space-y-4"
    >
      <PlacementSelects choice={choice} />
      <FormError error={error} />
      <FormActions
        loading={loading}
        submitLabel={submitLabel}
        askPlacement
        onSkip={() => void submit(true)}
      />
    </form>
  );
}

export function SignOutHint({ className }: { className?: string }) {
  const { signOut } = useClerk();
  return (
    <p className={cn("text-center text-xs text-muted-foreground", className)}>
      Not you, or in the wrong workspace?{" "}
      <button
        type="button"
        className="rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-ring"
        onClick={() => void signOut({ redirectUrl: "/sign-in" })}
      >
        Sign out
      </button>
    </p>
  );
}

type ProfileOnboardingProps = {
  /** "profile" collects the global profile (and placement, when the org has a
   * hierarchy). "placement" is for members whose profile is already complete
   * — e.g. from another org — but who have no department in this org. */
  mode: "profile" | "placement";
  /** Whether this org has departments to choose from. */
  askPlacement: boolean;
};

/** The standalone profile and placement screens, for members the first-run
 * welcome doesn't cover. */
export function ProfileOnboarding({ mode, askPlacement }: ProfileOnboardingProps) {
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
          {mode === "profile" ? (
            <ProfileFields
              askPlacement={askPlacement}
              submitLabel="Complete Profile"
            />
          ) : (
            <PlacementFields submitLabel="Continue" />
          )}
          <SignOutHint className="mt-6" />
        </CardContent>
      </Card>
    </div>
  );
}
