"use client";

import { C } from "./tokens";

export default function SectionTitle({ children }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 800,
        color: "#64748B",
        letterSpacing: "0.1em",
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <div style={{ flex: 1, height: 1, background: C.border }} />
      {children}
      <div style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );
}
