"use client";

import { useQuery, useMutation } from "convex/react";
import { Suspense, useEffect } from "react";
import { api } from "../../../convex/_generated/api";
import { ProcessWorkbench } from "@/features/workbench/process-workbench";
import { ProfileOnboarding } from "@/features/profile/profile-onboarding";
import { LoadingScreen } from "@/components/ui/loading-screen";

export default function OrgHomePage() {
  const user = useQuery(api.users.getMe);
  const placement = useQuery(api.users.getMyPlacement);
  const storeUser = useMutation(api.users.store);

  useEffect(() => {
    void storeUser();
  }, [storeUser]);

  if (user === undefined || placement === undefined) {
    return <LoadingScreen message="Loading your workspace..." />;
  }

  if (user === null) {
    return <LoadingScreen message="Setting up your workspace..." />;
  }

  // The profile is global (once per person); placement is per org. A member
  // who completed their profile in another org still owes this org a
  // department, but only once this org has a hierarchy to choose from.
  const needsPlacement =
    placement !== null && placement.orgHasDepartments && !placement.placement;

  if (!user.profileComplete) {
    return (
      <ProfileOnboarding mode="profile" askPlacement={needsPlacement} />
    );
  }

  if (needsPlacement) {
    return <ProfileOnboarding mode="placement" askPlacement />;
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* Suspense boundary required: ProcessWorkbench reads useSearchParams, which
          would otherwise fail the production build ("Missing Suspense boundary
          with useSearchParams"). */}
      <Suspense fallback={<LoadingScreen message="Loading your workspace..." />}>
        <ProcessWorkbench />
      </Suspense>
    </div>
  );
}
