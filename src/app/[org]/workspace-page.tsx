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
import { FirstRunFlow } from "@/features/onboarding/first-run-flow";
import { LoadingScreen } from "@/components/ui/loading-screen";

export default function OrgHomePage() {
  const user = useQuery(api.users.getMe);
  const placement = useQuery(api.users.getMyPlacement);
  const onboarding = useQuery(api.onboarding.getMyOnboarding);

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

  if (
    user === undefined ||
    placement === undefined ||
    onboarding === undefined
  ) {
    return <LoadingScreen message="Loading workspace…" />;
  }

  // The workspace layout provisions the user before mounting this page, so
  // null only lasts until that write reaches this query.
  if (user === null) {
    return <LoadingScreen message="Loading workspace…" />;
  }

  // Members who joined after onboarding launched get the welcome once. It
  // asks for the profile and placement itself, so the screens below only
  // serve everyone else. It renders on this route, so a deep link's query
  // string is still there when the workbench mounts.
  if (onboarding?.eligible && onboarding.path && !onboarding.welcomed) {
    return (
      <FirstRunFlow
        onboarding={{ ...onboarding, path: onboarding.path }}
        userName={user.name}
        profileComplete={user.profileComplete}
        placementOwed={needsPlacement}
      />
    );
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
      <Suspense fallback={<LoadingScreen message="Loading workspace…" />}>
        <ProcessWorkbench />
      </Suspense>
    </div>
  );
}
