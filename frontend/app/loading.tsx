function LoadingBlock({
  width = "100%",
  height = 16,
  radius = 8,
  style = {},
}: {
  width?: string | number;
  height?: string | number;
  radius?: string | number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="route-loading-shimmer"
      style={{
        width,
        height,
        borderRadius: radius,
        background: "#E8EDF2",
        overflow: "hidden",
        position: "relative",
        ...style,
      }}
    />
  );
}

export default function Loading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      style={{
        minHeight: "100vh",
        background: "#F4F2EE",
        color: "#0F1923",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}
    >
      <style>{`
        .route-loading-shimmer::after {
          content: "";
          position: absolute;
          inset: 0;
          transform: translateX(-100%);
          background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.68) 48%, transparent 100%);
          animation: routeShimmer 1.2s ease-in-out infinite;
        }
        @keyframes routeShimmer {
          100% { transform: translateX(100%); }
        }
        @keyframes routeSpin {
          to { transform: rotate(360deg); }
        }
        @media (max-width: 760px) {
          .route-loading-nav { display: none !important; }
          .route-loading-grid { grid-template-columns: 1fr !important; padding: 16px !important; }
          .route-loading-side { display: none !important; }
        }
      `}</style>

      <header
        style={{
          height: 60,
          padding: "0 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "rgba(240,238,233,0.97)",
          borderBottom: "1px solid #E8EDF2",
          boxShadow: "0 1px 0 rgba(15,25,35,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <LoadingBlock width={34} height={34} radius={9} />
          <LoadingBlock width={112} height={18} radius={6} />
        </div>
        <nav className="route-loading-nav" style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {[78, 58, 64, 70, 52, 92, 68, 58].map((width, index) => (
            <LoadingBlock key={index} width={width} height={12} radius={6} />
          ))}
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <LoadingBlock width={92} height={34} radius={16} />
          <LoadingBlock width={38} height={34} radius={8} />
        </div>
      </header>

      <div
        style={{
          height: 3,
          background: "linear-gradient(90deg, #0D9E6E 0%, #22C78E 48%, transparent 100%)",
          transformOrigin: "left",
        }}
      />

      <main
        className="route-loading-grid"
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          padding: 24,
          display: "grid",
          gridTemplateColumns: "280px minmax(0, 1fr)",
          gap: 20,
          alignItems: "start",
        }}
      >
        <aside
          className="route-loading-side"
          style={{
            background: "#FFFFFF",
            border: "1px solid #E8EDF2",
            borderRadius: 14,
            padding: 16,
            boxShadow: "0 2px 12px rgba(15,25,35,0.04)",
          }}
        >
          <LoadingBlock width={96} height={11} radius={6} style={{ marginBottom: 18 }} />
          {[0, 1, 2].map((item) => (
            <div key={item} style={{ padding: "12px 0", borderTop: item ? "1px solid #F1F5F9" : "none" }}>
              <LoadingBlock width="72%" height={13} radius={6} style={{ marginBottom: 8 }} />
              <LoadingBlock width="46%" height={10} radius={6} />
            </div>
          ))}
        </aside>

        <section
          style={{
            background: "#FFFFFF",
            border: "1px solid #E8EDF2",
            borderRadius: 14,
            minHeight: 360,
            padding: 22,
            boxShadow: "0 2px 12px rgba(15,25,35,0.04)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 12,
                border: "3px solid rgba(13,158,110,0.16)",
                borderTopColor: "#0D9E6E",
                animation: "routeSpin 0.85s linear infinite",
                flexShrink: 0,
              }}
            />
            <div>
              <LoadingBlock width={170} height={16} radius={6} style={{ marginBottom: 8 }} />
              <LoadingBlock width={250} height={11} radius={6} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 22 }}>
            {[0, 1, 2, 3].map((item) => (
              <div key={item} style={{ border: "1px solid #EEF2F6", borderRadius: 12, padding: 14 }}>
                <LoadingBlock width="54%" height={10} radius={6} style={{ marginBottom: 12 }} />
                <LoadingBlock width="72%" height={22} radius={7} />
              </div>
            ))}
          </div>

          <LoadingBlock width="42%" height={14} radius={7} style={{ marginBottom: 14 }} />
          <LoadingBlock width="100%" height={82} radius={12} style={{ marginBottom: 12 }} />
          <LoadingBlock width="92%" height={82} radius={12} />
        </section>
      </main>
    </div>
  );
}
