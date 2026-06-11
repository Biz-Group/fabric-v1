"use client";

import { useEffect } from "react";

const localHostnames = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLocalHostname(hostname: string) {
  return (
    localHostnames.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname === "lvh.me" ||
    hostname.endsWith(".lvh.me")
  );
}

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const canRegister =
      window.location.protocol === "https:" ||
      isLocalHostname(window.location.hostname);

    if (!canRegister) return;

    let cancelled = false;

    const register = () => {
      if (cancelled) return;

      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Service workers can be unavailable in some embedded previews.
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
