import type { NextConfig } from "next";

// Importing the env module here means a misconfigured deployment fails during
// `next build` — before an artifact exists — instead of on the first request
// after it has already been promoted to production.
import "./lib/env";

/**
 * Content-Security-Policy.
 *
 * Deferred since Sprint 0 on the grounds that a CSP written before the origin
 * list is known is either theatre or an outage. Twelve sprints later the list
 * is known, so here it is.
 *
 * ## `unsafe-inline` on styles, and why it is not negotiable yet
 *
 * Next.js injects inline `<style>` for streamed CSS, and `next-themes` writes an
 * inline script to set the theme before first paint — which is what prevents the
 * white flash on a dark-mode load. Both need either `unsafe-inline` or a
 * per-request nonce, and a nonce forces every page dynamic, which would opt the
 * landing page out of static rendering to harden a directive that mainly guards
 * against injected styles.
 *
 * Scripts are the ones that matter, and they are constrained: `'self'` plus the
 * two vendors whose SDKs actually load code (Clerk, Stripe). `'unsafe-eval'` is
 * **not** granted.
 *
 * ## It enforces by default, as of Sprint 15
 *
 * Sprint 13 shipped it Report-Only with `CSP_ENFORCE=1` to flip it, reasoning
 * that a policy which has never seen real traffic will block something and that
 * a customer who cannot check out is the worst way to find out.
 *
 * That reasoning assumed reports would accumulate. They cannot: nothing has
 * been deployed, so there is no traffic to observe, and "wait for evidence"
 * became "ship a header that blocks nothing, indefinitely". A report-only CSP
 * is a measurement instrument, and this one was measuring an empty room.
 *
 * Enforcing by default inverts the failure: breakage now surfaces in staging,
 * on the first click, to whoever is deploying — which is exactly who should
 * find it. `CSP_REPORT_ONLY=1` goes back to observing if a real deployment
 * turns up something that needs to be diagnosed rather than fixed.
 */
/**
 * The bucket's public hostname, as a `remotePatterns` entry.
 *
 * Returns an empty array when unset, so a deployment without storage still
 * builds — generation is disabled in that case anyway.
 */
function r2CustomDomainPattern() {
  const url = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (!url) return [];

  try {
    const { hostname } = new URL(url);
    return [{ protocol: "https" as const, hostname }];
  } catch {
    // A malformed URL is caught by lib/env.ts with a better message. Do not
    // fail the header/image config on it as well.
    return [];
  }
}

const CSP_DIRECTIVES = [
  "default-src 'self'",

  // Clerk and Stripe both load and execute their own SDKs. Nothing else does,
  // and `unsafe-eval` is still granted to nobody.
  //
  // `wasm-unsafe-eval` is a *narrower* grant added in Sprint 27 and is not the
  // same permission: it allows compiling and instantiating WebAssembly and
  // nothing else — `eval` and `new Function` on JavaScript stay blocked. It is
  // required by the ffmpeg build that concatenates a sequence's clips in the
  // browser. Doing that on the server would mean a 70 MB binary inside a
  // function that Vercel's Hobby plan kills at 60 seconds.
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://*.clerk.accounts.dev https://*.clerk.com https://js.stripe.com https://challenges.cloudflare.com",

  // ffmpeg.wasm runs its work off the main thread and builds that worker from
  // a blob URL. Without this the stitch freezes the tab it runs in.
  "worker-src 'self' blob:",

  // See above — Next's streamed CSS and the theme script need this.
  "style-src 'self' 'unsafe-inline'",

  // R2 for generated media and uploaded references, Clerk for avatars.
  // `blob:` is object URLs for reference-image previews; `data:` is the mock
  // provider's SVG output.
  //
  // UploadThing's hosts (utfs.io, *.ufs.sh) were removed in Sprint 14 with the
  // package: nothing has ever loaded an image from them, and an allowed origin
  // nobody uses is an allowed origin nobody is watching.
  "img-src 'self' data: blob: https://*.r2.dev https://*.r2.cloudflarestorage.com https://img.clerk.com https://images.clerk.dev",
  "media-src 'self' blob: https://*.r2.dev https://*.r2.cloudflarestorage.com",

  "font-src 'self' data:",

  // Our own API, Clerk's, Stripe's. Provider calls are server-side and never
  // originate from a browser, so no AI vendor belongs here.
  "connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://api.stripe.com https://*.r2.dev https://*.r2.cloudflarestorage.com",

  // Stripe Checkout and the billing portal render in an iframe; Clerk uses one
  // for captcha.
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://challenges.cloudflare.com https://*.clerk.accounts.dev",

  // Nothing may frame us — the header equivalent of X-Frame-Options, and the
  // one modern browsers actually honour.
  "frame-ancestors 'none'",

  // No plugins, and no <base> at all — `'self'` still permits an injected
  // <base href="/evil/"> to repoint every relative URL on the page, and nothing
  // in this app uses the element.
  "object-src 'none'",
  "base-uri 'none'",

  // Forms post to us and to Stripe. Without this, an injected form could
  // exfiltrate a submission to any origin.
  "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",

  "upgrade-insecure-requests",
].join("; ");

const cspHeaderKey =
  process.env.CSP_REPORT_ONLY === "1"
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";

/**
 * Security headers.
 *
 * Applied to every response.
 */
const securityHeaders = [
  { key: cspHeaderKey, value: CSP_DIRECTIVES },

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
    /**
     * Explicit allowlist. A wildcard here turns our image endpoint into an open
     * proxy that anyone can use to resize arbitrary images at our expense.
     *
     * The custom-domain entry is derived from `NEXT_PUBLIC_R2_PUBLIC_URL` at
     * build time. Until Sprint 16 there was no such entry, and the gap was the
     * stated reason five components fell back to a raw `<img>`: "asset hosts
     * are per-deployment, so next/image would need every possible R2 hostname
     * at build time". That was true of *every possible* host and false of
     * *this* one — the bucket's public URL is a build-time variable, so its
     * hostname is knowable. Deriving it is what unlocked responsive images
     * across the galleries.
     *
     * UploadThing's hosts were removed with the package in Sprint 14; they
     * survived here because nothing pointed at this list.
     */
    remotePatterns: [
      { protocol: "https" as const, hostname: "*.r2.dev" },
      { protocol: "https" as const, hostname: "*.r2.cloudflarestorage.com" },
      { protocol: "https" as const, hostname: "img.clerk.com" },
      { protocol: "https" as const, hostname: "images.clerk.dev" },
      ...r2CustomDomainPattern(),
    ],
    // Generated media is immutable — once written, an object key never changes
    // content. Cache it for a year.
    minimumCacheTTL: 31_536_000,
    /**
     * The widths Next will actually generate.
     *
     * Trimmed from the defaults. Every extra width is another variant to
     * generate and store per image, and the layouts here are a card grid and a
     * single detail view — there is no 3840px surface in this product.
     */
    deviceSizes: [640, 828, 1080, 1200, 1920],
    imageSizes: [96, 160, 256, 384],
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
    return [
      { source: "/:path*", headers: securityHeaders },

      /**
       * Caching, by route class.
       *
       * Next already sets sensible defaults per rendering mode; these cover the
       * cases where the default is wrong or absent.
       */
      {
        // Every API response is per-user or a mutation. A shared cache holding
        // one user's credit balance and serving it to another is the failure
        // this exists to make impossible.
        source: "/api/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, private",
          },
        ],
      },
      {
        // Fingerprinted build output. The filename changes when the content
        // does, so a year is safe and anything less is wasted bandwidth.
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        // The fixture clip is a dev asset that never changes.
        source: "/dev/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400" },
          // Belt and braces alongside the `(dev)` layout's metadata: a file
          // served outside a page has no metadata to carry the rule.
          { key: "X-Robots-Tag", value: "noindex" },
        ],
      },
    ];
  },
};

export default nextConfig;
