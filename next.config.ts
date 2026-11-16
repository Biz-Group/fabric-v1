import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/** Host of the Clerk Frontend API, decoded from the publishable key
 * (`pk_live_<base64("clerk.bizfabric.ai$")>`), so the CSP names this
 * environment's Clerk instance exactly. */
function clerkFrontendApiHost(): string | null {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  const encoded = key.replace(/^pk_(?:live|test)_/, "");
  if (!encoded || encoded === key) return null;
  try {
    const host = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
    return /^[a-z0-9.-]+$/i.test(host) ? host : null;
  } catch {
    return null;
  }
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

const clerkHost = clerkFrontendApiHost();
const convexCloudHost =
  hostOf(process.env.NEXT_PUBLIC_CONVEX_URL) ?? "*.convex.cloud";
const convexSiteHost =
  hostOf(process.env.NEXT_PUBLIC_CONVEX_SITE_URL) ?? "*.convex.site";
const clerkSources = clerkHost
  ? [`https://${clerkHost}`]
  : ["https://*.clerk.accounts.dev"];

// Where images, network calls and audio may come from. Enforced (step 1 of
// D7, docs/security-hardening-task-list.md): an image or request to any other
// host is blocked, which stops model output from leaking data to a URL even if
// something renders it.
const imgSrc = [
  "img-src 'self' blob: data:",
  "https://img.clerk.com",
  `https://${convexCloudHost}`,
  "https://storage.googleapis.com",
].join(" ");
const connectSrc = [
  "connect-src 'self'",
  ...clerkSources,
  "https://clerk-telemetry.com",
  // Clerk's bot protection (Turnstile) on sign-up. It's a per-instance Clerk
  // setting, so prod may use it when dev doesn't: allowed regardless.
  "https://challenges.cloudflare.com",
  `https://${convexCloudHost}`,
  `wss://${convexCloudHost}`,
  `https://${convexSiteHost}`,
  // Interviews: the conversation token flow connects to
  // wss://livekit.rtc.elevenlabs.io.
  "https://*.elevenlabs.io",
  "wss://*.elevenlabs.io",
  "https://storage.googleapis.com",
].join(" ");
// Stored read-aloud audio plays from a Convex storage URL (convex.cloud);
// streamed audio and recordings come from the HTTP actions (convex.site).
const mediaSrc = `media-src 'self' blob: data: https://${convexCloudHost} https://${convexSiteHost}`;

// The full allowlist, still Report-Only for scripts, styles, workers and
// forms: violations show in the browser console without breaking anything.
// Enforce those (step 2) after a smoke test of sign-in, recording, audio
// playback, the tenants console and MCP cards with the console open.
// Without nonces, inline scripts need 'unsafe-inline'; the policy still
// stops scripts and data flowing to any host not listed here.
const reportOnlyCsp = [
  "default-src 'self'",
  [
    "script-src 'self' 'unsafe-inline'",
    ...(isDev ? ["'unsafe-eval'"] : []),
    ...clerkSources,
    "https://challenges.cloudflare.com",
    // The ElevenLabs SDK loads its audio resampler worklet from here.
    "https://cdn.jsdelivr.net",
  ].join(" "),
  "style-src 'self' 'unsafe-inline'",
  imgSrc,
  "font-src 'self' data:",
  connectSrc,
  mediaSrc,
  "worker-src 'self' blob:",
  "frame-src https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// Enforced: nothing frames the app, uses plugins, or rewrites the document
// base URL; and images, network calls and media are held to the allowlist.
const enforcedCsp = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  imgSrc,
  connectSrc,
  mediaSrc,
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: enforcedCsp },
  { key: "Content-Security-Policy-Report-Only", value: reportOnlyCsp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    // Microphone is needed for interview recording, on our own origin only.
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()",
  },
  ...(isDev
    ? []
    : [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains",
        },
      ]),
];

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
    // Order matters: a later entry overrides the same header key from an
    // earlier one, so the service worker keeps its own stricter CSP.
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
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
