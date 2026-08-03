"use client";

/**
 * The last resort.
 *
 * Catches failures in the **root layout itself** — the one place `error.tsx`
 * cannot help, because it renders inside the layout that just failed. Next
 * requires this file to supply its own `<html>` and `<body>`.
 *
 * ## No design system here, deliberately
 *
 * If the root layout threw, the theme provider, the font and the global
 * stylesheet may all be part of what broke. Importing a component from
 * `components/ui` would risk the error boundary failing for the same reason as
 * the page, which produces a blank screen rather than a message.
 *
 * So this is inline styles and system fonts. It is the ugliest file in the
 * repository and that is the point: it has to render when nothing else does.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0b0b0f",
          color: "#e9e9ef",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
          padding: "2rem",
        }}
      >
        <main style={{ maxWidth: "32rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
            Atheos could not start
          </h1>
          <p
            style={{
              marginTop: "0.75rem",
              fontSize: "0.875rem",
              lineHeight: 1.6,
              color: "#a1a1b5",
            }}
          >
            Something failed before the page could render. This is on our side,
            not yours.
          </p>

          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: "1px solid #2a2a35",
              background: "#16161d",
              color: "inherit",
              font: "inherit",
              fontSize: "0.875rem",
              cursor: "pointer",
              // 24px minimum, even here. The one screen somebody is guaranteed
              // to be frustrated on is not the place to shrink the only button.
              minHeight: "2.25rem",
            }}
          >
            Reload
          </button>

          {error.digest ? (
            <p
              style={{
                marginTop: "1.5rem",
                fontSize: "0.75rem",
                color: "#6c6c80",
              }}
            >
              Reference <code>{error.digest}</code>
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
