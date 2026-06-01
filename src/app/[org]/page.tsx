"use client";

import { useQuery, useMutation } from "convex/react";
import { Suspense, useEffect } from "react";
import { api } from "../../../convex/_generated/api";
import { MillerColumns } from "@/components/miller-columns";
import { ProfileOnboarding } from "@/components/profile-onboarding";
import { LoadingScreen } from "@/components/ui/loading-screen";

export default function OrgHomePage() {
  const user = useQuery(api.users.getMe);
  const storeUser = useMutation(api.users.store);

  useEffect(() => {
    void storeUser();
  }, [storeUser]);

  if (user === undefined) {
    return <LoadingScreen message="Loading your workspace..." />;
  }

  if (user === null) {
    return <LoadingScreen message="Setting up your workspace..." />;
  }

  if (!user.profileComplete) {
    return <ProfileOnboarding />;
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* Suspense boundary required: MillerColumns reads useSearchParams, which
          would otherwise fail the production build ("Missing Suspense boundary
          with useSearchParams"). */}
      <Suspense fallback={<LoadingScreen message="Loading your workspace..." />}>
        <MillerColumns />
      </Suspense>
    </div>
  );
}
