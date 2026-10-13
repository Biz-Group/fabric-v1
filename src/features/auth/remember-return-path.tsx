"use client";

import { useEffect } from "react";
import { rememberReturnPathFromUrl } from "./return-path";

/** Records this sign-in's `redirect_url` for `/join-organization` to use. */
export function RememberReturnPath() {
  useEffect(() => {
    rememberReturnPathFromUrl();
  }, []);
  return null;
}
