import { ImageResponse } from "next/og";

export const alt = "Ledgerly: run your whole business from one app";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: "#059669", color: "white" }}>
        <div style={{ fontSize: 40, fontWeight: 600, opacity: 0.9 }}>Ledgerly</div>
        <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.1, marginTop: 24 }}>Run your whole business from one simple app</div>
        <div style={{ fontSize: 34, marginTop: 36, opacity: 0.9 }}>Invoices, clients, expenses and bookings. Made in South Africa.</div>
      </div>
    ),
    size,
  );
}
