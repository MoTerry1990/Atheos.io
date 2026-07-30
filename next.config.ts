import type { NextConfig } from "next";

// Importing the env module here means a misconfigured deployment fails during
// `next build` — before an artifact exists — instead of on the first request
// after it has already been promoted to production.
import "./lib/env";

/**
 * Security headers.
 *
 * Applied to every response. A Content-Security-Policy is deliberately absent
 * for now: Clerk, Stripe and the AI provider domains each need their own
 * allowances, and a CSP written before those are known is either so permissive
 * it is theatre, or so strict it breaks checkout. It lands in Sprint 7 with the
 * real origin list.
 */
const securityHeaders = [
  // Don't let the browser second-guess our Content-Type. MIME sniffing turns an
  // uploaded text file into an executed script.
  { key: "X-Content-Type-Options", value: "nosniff" },

  // Users upload source images here; framing the app on another origin enables
  // clickjacking against destructive actions.
  { key: "X-Frame-Options", value: "DENY" },

  // Send the full URL to ourselves, only the origin cross-site. Generation URLs
  // can contain identifiers that should not leak in a Referer header.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // Deny hardware access we never ask for. Narrow it when a feature needs it.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },

  // HSTS. Only meaningful over HTTPS, ignored by browsers on localhost.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },

  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Do not advertise the framework and version to every scanner on the internet.
  poweredByHeader: false,

  // Trailing-slash redirects are a wasted round trip; be consistent instead.
  trailingSlash: false,

  typescript: {
    // Never ship a build that does not typecheck. If this is ever flipped to
    // `true`, the type system has stopped being a guarantee and is only a
    // suggestion.
    ignoreBuildErrors: false,
  },

  eslint: {
    ignoreDuringBuilds: false,
    dirs: [
      "app",
      "components",
      "features",
      "hooks",
      "lib",
      "providers",
      "services",
      "store",
      "utils",
    ],
  },

  images: {
    // Modern formats first; Next falls back automatically for older clients.
    formats: ["image/avif", "image/webp"],
    // Explicit allowlist. A wildcard here turns our image endpoint into an open
    // proxy that anyone can use to resize arbitrary images at our expense.
    remotePatterns: [
      { protocol: "https", hostname: "*.r2.dev" },
      { protocol: "https", hostname: "*.r2.cloudflarestorage.com" },
      { protocol: "https", hostname: "utfs.io" },
      { protocol: "https", hostname: "*.ufs.sh" },
      { protocol: "https", hostname: "img.clerk.com" },
      { protocol: "https", hostname: "images.clerk.dev" },
    ],
    // Generated media is immutable — once written, an object key never changes
    // content. Cache it for a year.
    minimumCacheTTL: 31_536_000,
  },

  experimental: {
    // Import only the icons actually used rather than the whole barrel file.
    // Without this, a single lucide import pulls thousands of modules into the
    // dev compile and measurably slows every page load.
    optimizePackageImports: ["lucide-react", "motion"],
  },

  // Keep server-only native dependencies out of the bundler's way.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg"],

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
