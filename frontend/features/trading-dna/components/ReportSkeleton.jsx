"use client";

import { C } from "./tokens";

function ShimmerLine({ width = "100%", height = 14 }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 6,
        background:
          "linear-gradient(90deg,#F1F5F9 25%,#E2E8F0 50%,#F1F5F9 75%)",
        backgroundSize: "200% 100%",
        animation: "tradingDnaShimmer 1.5s infinite",
        marginBottom: 10,
      }}
    />
  );
}

export default function ReportSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        style={{
          background: C.bgDeep,
          borderRadius: 18,
          padding: "28px",
          color: "#F8FAFC",
        }}
      >
        <ShimmerLine width="40%" height={10} />
        <ShimmerLine width="70%" height={28} />
        <ShimmerLine width="50%" height={14} />
      </div>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            background: C.surface,
            borderRadius: 14,
            border: `1px solid ${C.border}`,
            padding: "20px",
          }}
        >
          <ShimmerLine width="30%" height={10} />
          <ShimmerLine />
          <ShimmerLine />
          <ShimmerLine width="80%" />
        </div>
      ))}
      <style>{`
        @keyframes tradingDnaShimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
