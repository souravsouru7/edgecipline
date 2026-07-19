"use client";

import Image from "next/image";
import Link from "next/link";
import { Pencil, PlayCircle } from "lucide-react";

// `selectedStyle` carries the starter setup returned by the server
// (seedSetup{name, rules}). The style label is optional because onboarding now
// sends users straight from market selection to setup creation.
export default function SetupStep({ selectedStyle, customising, custom, onCustomToggle, onCustomChange, market }) {
  const seed = selectedStyle?.seedSetup;
  const indianRoot = market === "Indian_Market" ? "/indian-market" : "";
  const samplePath = market === "Indian_Market" ? "/sample_indianmarket.jpeg" : "/sample.png";
  if (!seed) {
    return <div style={{ color: "#94A3B8", fontSize: 12 }}>Loading your starter setup...</div>;
  }
  return (
    <div>
      <div style={{
        padding: "14px 14px",
        borderRadius: 12,
        background: "rgba(34,199,142,0.06)",
        border: "1px solid rgba(34,199,142,0.18)",
        marginBottom: 12,
      }}>
        <div style={{ fontSize: 10, color: "#22C78E", letterSpacing: "0.1em", fontWeight: 800, marginBottom: 6, textTransform: "uppercase" }}>
          Starter setup
        </div>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#F1F5F9", marginBottom: 8 }}>
          {customising ? (custom?.name || seed.name) : seed.name}
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, color: "#CBD5E1", fontSize: 12, lineHeight: 1.6 }}>
          {(customising ? (custom?.rules || []) : seed.rules).map((rule, i) => (
            <li key={i}>{rule}</li>
          ))}
        </ul>
      </div>

      {customising ? (
        <div style={{ display: "grid", gap: 10 }}>
          <input
            value={custom?.name || ""}
            onChange={(event) => onCustomChange({ ...custom, name: event.target.value.slice(0, 80) })}
            placeholder="Setup name (e.g. Daily breakout)"
            style={inputStyle}
          />
          {Array.from({ length: Math.max(3, (custom?.rules || []).length) }).map((_, i) => (
            <input
              key={i}
              value={(custom?.rules || [])[i] || ""}
              onChange={(event) => {
                const next = [...(custom?.rules || [])];
                next[i] = event.target.value.slice(0, 200);
                onCustomChange({ ...custom, rules: next.filter((value, idx) => value || idx < (custom?.rules || []).length) });
              }}
              placeholder={`Rule ${i + 1}`}
              style={inputStyle}
            />
          ))}
          <button
            type="button"
            onClick={onCustomToggle}
            style={ghostBtnStyle}
          >
            Use the default instead
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onCustomToggle}
          style={{ ...ghostBtnStyle, display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <Pencil size={12} /> Customise this setup
        </button>
      )}

      <div style={{
        marginTop: 12,
        padding: "12px",
        borderRadius: 12,
        background: "rgba(14,165,233,0.08)",
        border: "1px solid rgba(14,165,233,0.24)",
        display: "flex",
        gap: 12,
        alignItems: "center",
      }}>
        <div style={{
          width: 94,
          height: 62,
          borderRadius: 9,
          overflow: "hidden",
          border: "1px solid rgba(14,165,233,0.35)",
          background: "#FFFFFF",
          flexShrink: 0,
          position: "relative",
        }}>
          <Image
            src={samplePath}
            alt="Sample broker screenshot"
            fill
            sizes="94px"
            style={{ objectFit: "cover" }}
          />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 10, color: "#38BDF8", letterSpacing: "0.1em", fontWeight: 800, marginBottom: 4, textTransform: "uppercase" }}>
            Example demo
          </div>
          <div style={{ fontSize: 12, color: "#CBD5E1", lineHeight: 1.5, marginBottom: 8 }}>
            See how a broker screenshot is read. Demo mode does not save a trade.
          </div>
          <Link
            href={`${indianRoot}/upload-trade?onboarding=1&demo=1`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: "#38BDF8",
              textDecoration: "none",
              fontSize: 11,
              fontWeight: 800,
            }}
          >
            <PlayCircle size={13} />
            Try demo
          </Link>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#F1F5F9",
  fontSize: 12,
  fontFamily: "inherit",
  outline: "none",
};

const ghostBtnStyle = {
  background: "transparent",
  border: "1px dashed rgba(255,255,255,0.15)",
  color: "#94A3B8",
  padding: "8px 12px",
  borderRadius: 10,
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};
