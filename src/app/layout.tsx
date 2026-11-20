import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import { SITE_URL } from "@/lib/site-url";
import { ServiceWorkerRegistration } from "@/components/providers/service-worker-registration";
import { THEME_INITIALIZATION_SCRIPT } from "@/features/theming/theme-config";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const developmentServiceWorkerCleanup = `
(() => {
  if (!("serviceWorker" in navigator)) return;

  const cachePrefix = "fabric-pwa";
  const reloadKey = "fabric:development-service-worker-cleanup";
  const hadController = Boolean(navigator.serviceWorker.controller);

  const unregisterWorkers = navigator.serviceWorker
    .getRegistrations()
    .then((registrations) =>
      Promise.all(registrations.map((registration) => registration.unregister())),
    );

  const clearFabricCaches = "caches" in window
    ? window.caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(cachePrefix))
            .map((key) => window.caches.delete(key)),
        ),
      )
    : Promise.resolve();

  Promise.all([unregisterWorkers, clearFabricCaches])
    .then(() => {
      if (hadController && sessionStorage.getItem(reloadKey) !== "done") {
        sessionStorage.setItem(reloadKey, "done");
        window.location.reload();
        return;
      }

      if (!navigator.serviceWorker.controller) {
        sessionStorage.removeItem(reloadKey);
      }
    })
    .catch(() => {
      // Browsers can restrict service-worker storage in private previews.
    });
})();
`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: "Fabric",
  // Pages set `title` to their own name; the template adds the product.
  title: { default: "Fabric", template: "%s | Fabric" },
  description: "Capture how your organisation works through conversations",
  appleWebApp: {
    capable: true,
    title: "Fabric",
    statusBarStyle: "black-translucent",
  },
  icons: {
    shortcut: "/favicon.ico",
    icon: [
      {
        url: "/fabric-icon-black.ico",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/fabric-icon.ico",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    apple: [
      {
        url: "/pwa/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F5F0" },
    { media: "(prefers-color-scheme: dark)", color: "#191A1D" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en-GB"
      data-theme="light"
      data-theme-preference="system"
      suppressHydrationWarning
      className={`${inter.variable} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: THEME_INITIALIZATION_SCRIPT }}
        />
      </head>
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        {process.env.NODE_ENV === "development" ? (
          <Script
            id="development-service-worker-cleanup"
            strategy="beforeInteractive"
          >
            {developmentServiceWorkerCleanup}
          </Script>
        ) : null}
        {/* Clerk, Convex and the app theme live in `(app)/layout.tsx`, so
            the public site doesn't load them (marketing plan 4.5). */}
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
