"use client";

import { RouteError } from "@/features/shell/route-error";

// Catches errors from workspace pages. Renders inside the workspace layout,
// so the org theme and toaster stay in place.
export default RouteError;
