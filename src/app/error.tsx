"use client";

import { RouteError } from "@/features/shell/route-error";

// Catches what the workspace boundary can't: errors in the workspace layout
// itself, the tenant console, and the auth pages.
export default RouteError;
