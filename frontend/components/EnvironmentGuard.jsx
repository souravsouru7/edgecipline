"use client";

import { validateEnvironment } from "@/config/environment";

export default function EnvironmentGuard({ children }) {
  try {
    validateEnvironment();
    return children;
  } catch (error) {
    const details = Array.isArray(error?.errors)
      ? error.errors
      : [error?.message || "Unknown configuration error."];

    return (
      <main
        role="alert"
        style={{
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background: "#f7f8fa",
          color: "#17202a",
          fontFamily: "'Plus Jakarta Sans', sans-serif",
        }}
      >
        <section style={{ width: "100%", maxWidth: "680px" }}>
          <p style={{ color: "#b42318", fontWeight: 800, marginBottom: "8px" }}>
            APP CONFIGURATION ERROR
          </p>
          <h1 style={{ fontSize: "28px", margin: "0 0 12px" }}>
            Edgecipline cannot start safely.
          </h1>
          <p style={{ lineHeight: 1.6, marginBottom: "20px" }}>
            This build is missing required production configuration. No API
            connection has been attempted.
          </p>
          <ul style={{ lineHeight: 1.7, paddingLeft: "20px" }}>
            {details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        </section>
      </main>
    );
  }
}

