"use client";

import { useQuery } from "convex/react";
import { Suspense, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { ProcessWorkbench } from "@/features/workbench/process-workbench";
import { ProfileOnboarding } from "@/features/profile/profile-onboarding";
import {
  livePlacementGate,
  resolvePlacementGate,
} from "@/features/profile/placement-gate";
import { LoadingScreen } from "@/components/ui/loading-screen";

export default function OrgHomePage() {
  const user = useQuery(api.users.getMe);
  const placement = useQuery(api.users.getMyPlacement);

  // Whether to ask "Where do you sit?" is decided once per mount: it can
  // close but never opens mid-task (see resolvePlacementGate). Leaving for
  // Admin or Release notes unmounts this page, so coming back asks again.
  const [placementGate, setPlacementGate] = useState<boolean | null>(null);
  const nextPlacementGate = resolvePlacementGate(
    placementGate,
    livePlacementGate(placement),
  );
  if (nextPlacementGate !== placementGate) setPlacementGate(nextPlacementGate);
  const needsPlacement = nextPlacementGate === true;

  if (user === undefined || placement === undefined) {
    return <LoadingScreen message="Loading your workspace..." />;
  }

  // The workspace layout provisions the user before mounting this page, so
  // null only lasts until that write reaches this query.
  if (user === null) {
    return <LoadingScreen message="Setting up your workspace..." />;
  }

  // The latched gate also decides the profile form's placement fields, so they
  // don't appear in a half-filled form when someone adds the first department.
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
