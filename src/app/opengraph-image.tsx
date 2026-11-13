import { ImageResponse } from "next/og";

export const alt = "Ledgerly by ASC: run your whole business from one app";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: "#176e56", color: "#f2f0e8" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <svg width="120" height="120" viewBox="0 0 100 100">
            <polygon points="62,13 34,80 95,80" fill="#f2f0e8" stroke="#f2f0e8" strokeWidth="3" strokeLinejoin="round" />
            <polygon points="29,44 6,80 55,80" fill="#e8d6b0" stroke="#176e56" strokeWidth="3" strokeLinejoin="round" />
          </svg>
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 28 }}>
            <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: 10 }}>LEDGERLY</div>
            <div style={{ fontSize: 24, letterSpacing: 8, alignSelf: "flex-end", opacity: 0.75 }}>by ASC</div>
          </div>
        </div>
        <div style={{ fontSize: 66, fontWeight: 700, lineHeight: 1.1, marginTop: 56 }}>Run your whole business from one simple app</div>
        <div style={{ fontSize: 32, marginTop: 28, opacity: 0.9 }}>Invoices, clients, expenses and bookings. Made in South Africa.</div>
      </div>
    ),
    size,
  );
}
