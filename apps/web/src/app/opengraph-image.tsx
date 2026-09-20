import { ImageResponse } from "next/og";
import { SITE_DESCRIPTION, SITE_TAGLINE } from "@/lib/site";

export const alt = "Jeval — Know when your AI gets it wrong.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#faf8f4",
          color: "#17130f",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 36, fontWeight: 700 }}>
          <div style={{ width: 52, height: 52, borderRadius: 12, background: "#17130f", display: "flex", alignItems: "center", justifyContent: "center", color: "#faf8f4", fontSize: 30 }}>
            J
          </div>
          Jeval
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 88, fontWeight: 700, letterSpacing: -3, lineHeight: 1.02 }}>{SITE_TAGLINE}</div>
          <div style={{ fontSize: 34, color: "#5c554b", maxWidth: 1000, lineHeight: 1.35 }}>{SITE_DESCRIPTION}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 26, color: "#5c554b" }}>
          <div style={{ width: 16, height: 16, borderRadius: 8, background: "#cc4a0f" }} />
          Open source · judged by Jev · Cloud waitlist open
        </div>
      </div>
    ),
    size,
  );
}
