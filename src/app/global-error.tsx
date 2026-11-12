"use client";

/**
 * Last-resort screen when the root layout itself fails. It replaces the layout,
 * so it carries its own <html> and plain inline styles (the stylesheet may not have loaded).
 */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en-ZA">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 24,
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#f7f8fa",
          color: "#0f172a",
        }}
      >
        <h1 style={{ fontSize: 24, margin: 0 }}>Something went wrong</h1>
        <p style={{ margin: 0, color: "#566176" }}>Your data is safe. Try again in a moment.</p>
        <button
          type="button"
          onClick={() => retry()}
          style={{
            minHeight: 44,
            padding: "0 20px",
            borderRadius: 12,
            border: 0,
            background: "#047857",
            color: "#ffffff",
            fontSize: 16,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
