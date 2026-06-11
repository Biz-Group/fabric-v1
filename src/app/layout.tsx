import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { ui } from "@clerk/ui";
import { ConvexClientProvider } from "@/components/providers/convex-client-provider";
import { ServiceWorkerRegistration } from "@/components/providers/service-worker-registration";
import "./globals.css";

const clerkTaskUrls = {
  "choose-organization": "/join-organization",
};

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: "Fabric",
  title: "Fabric.",
  description: "Capture how your organization works through conversations",
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
    { media: "(prefers-color-scheme: dark)", color: "#11161C" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        <ClerkProvider taskUrls={clerkTaskUrls} ui={ui}>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ClerkProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
