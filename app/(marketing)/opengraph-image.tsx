import { ImageResponse } from "next/og";

import { SITE } from "@/features/marketing/content";
import { getCopy } from "@/features/marketing/i18n/dictionaries";

// These surfaces are English-only today: the auth screens and the OG image
// are not locale-routed. Reading the dictionary rather than inlining the
// strings means they follow when they are.
const copy = getCopy("en");

/**
 * Social share image, generated at build time.
 *
 * A generated OG image beats a static PNG for one practical reason: it cannot
 * fall out of sync with the product name or tagline, because it is built from
 * the same constants the page uses.
 *
 * ## Constraints worth knowing before editing
 *
 * `next/og` renders with Satori, which supports a **subset** of CSS. Flexbox
 * only — no grid, no float. Every element with more than one child needs an
 * explicit `display: flex`. No external stylesheets, so Tailwind classes do
 * nothing here and the design tokens have to be repeated as literals.
 *
 * No custom font is loaded on purpose: fetching one at build time makes the
 * build depend on a network round trip, which is a bad trade for a font nobody
 * examines at thumbnail size.
 *
 * 1200×630 is the size Open Graph and Twitter both crop from.
 */
export const alt = `${SITE.name} — ${copy.site.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: 80,
        backgroundColor: "#0a0a0b",
        // The aurora, hand-rolled: Satori has no CSS variables to read.
        backgroundImage:
          "radial-gradient(900px 500px at 10% -10%, rgba(139,63,240,0.35), transparent 60%)," +
          "radial-gradient(700px 420px at 95% 10%, rgba(56,150,240,0.28), transparent 55%)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {/* The mark is drawn from two rotated squares rather than set as a
              glyph. Satori has no font loaded, so any non-ASCII character
              triggers a network fetch for a fallback font — which fails in a
              sandboxed build and renders nothing. Geometry always works. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 64,
            height: 64,
            borderRadius: 18,
            backgroundImage: "linear-gradient(100deg, #a855f7, #6366f1)",
          }}
        >
          <div
            style={{
              display: "flex",
              width: 22,
              height: 22,
              borderRadius: 6,
              backgroundColor: "#ffffff",
              transform: "rotate(45deg)",
            }}
          />
        </div>
        <div style={{ fontSize: 38, color: "#fafafa", fontWeight: 600 }}>
          {SITE.name}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          marginTop: 48,
          fontSize: 82,
          lineHeight: 1.05,
          letterSpacing: -3,
          color: "#fafafa",
          fontWeight: 700,
          maxWidth: 900,
        }}
      >
        {copy.site.tagline}
      </div>

      <div
        style={{
          display: "flex",
          marginTop: 32,
          fontSize: 30,
          lineHeight: 1.4,
          color: "rgba(250,250,250,0.62)",
          maxWidth: 860,
        }}
      >
        Image and video generation across multiple AI models — one library, one
        credit balance.
      </div>

      <div
        style={{
          display: "flex",
          marginTop: "auto",
          fontSize: 24,
          color: "rgba(250,250,250,0.45)",
        }}
      >
        {SITE.domain}
      </div>
    </div>,
    size,
  );
}
