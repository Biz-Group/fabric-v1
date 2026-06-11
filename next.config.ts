import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` cross-origin warning list. Prod builds ignore this entirely;
  // these just suppress dev-server origin warnings when hitting the app from
  // subdomains via `lvh.me` (local dev) or the real domain (staging-on-prod).
  allowedDevOrigins: [
    "lvh.me",
    "*.lvh.me",
    "bizfabric.ai",
    "*.bizfabric.ai",
  ],
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          {
            key: "Content-Type",
            value: "application/manifest+json; charset=utf-8",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
