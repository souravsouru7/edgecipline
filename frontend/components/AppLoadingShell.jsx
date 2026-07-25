import Image from "next/image";

const PALETTES = {
  default: {
    bg: "#F4F2EE",
    ink: "#0F1923",
    accent: "#0D9E6E",
    accent2: "#B8860B",
    accent3: "#2563EB",
    danger: "#D63B3B",
    card: "#FFFFFF",
    border: "#E2E8F0",
    muted: "#64748B",
    soft: "#E8EDF2",
  },
  indian: {
    bg: "#F4F2EE",
    ink: "#0F1923",
    accent: "#0D9E6E",
    accent2: "#B8860B",
    accent3: "#2563EB",
    danger: "#D63B3B",
    card: "#FFFFFF",
    border: "#E2E8F0",
    muted: "#64748B",
    soft: "#E8EDF2",
  },
};

function Block({ width = "100%", height = 14, radius = 8, style = {} }) {
  return (
    <div
      className="app-loading-shimmer"
      style={{
        width,
        height,
        borderRadius: radius,
        background: "linear-gradient(90deg, #E8EDF2 0%, #F5F7FA 46%, #E8EDF2 100%)",
        backgroundSize: "240% 100%",
        overflow: "hidden",
        ...style,
      }}
    />
  );
}

function Header({ colors, showMarketTape }) {
  return (
    <>
      <header
        className="app-loading-header"
        style={{
          height: 64,
          padding: "0 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "rgba(244, 242, 238, 0.88)",
          borderBottom: `1px solid ${colors.border}`,
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
          <Block width={36} height={36} radius={10} />
          <div style={{ minWidth: 0 }}>
            <Block width={126} height={16} radius={7} style={{ marginBottom: 7 }} />
            <Block width={76} height={9} radius={5} />
          </div>
        </div>
        <nav className="app-loading-nav" style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {[72, 58, 84, 64, 76, 54].map((width, index) => (
            <Block key={index} width={width} height={11} radius={6} />
          ))}
        </nav>
        <div className="app-loading-actions" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Block width={92} height={34} radius={17} />
          <Block width={38} height={34} radius={10} />
        </div>
      </header>
      {showMarketTape && (
        <div
          className="app-loading-tape"
          style={{
            overflow: "hidden",
            background: colors.ink,
            borderBottom: `3px solid ${colors.accent2}`,
            padding: "7px 0",
          }}
        >
          <div style={{ display: "inline-flex", gap: 44, animation: "appLoadingTape 28s linear infinite" }}>
            {["NIFTY", "BANKNIFTY", "SENSEX", "FINNIFTY", "NSE", "BSE"].map((label) => (
              <span
                key={label}
                style={{
                  color: "#E8F5E9",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  whiteSpace: "nowrap",
                }}
              >
                {label} <span style={{ color: "#A5D6A7" }}>SYNCING</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function Kpi({ accent }) {
  return (
    <div className="app-loading-card app-loading-kpi">
      <div style={{ height: 3, background: `linear-gradient(90deg, ${accent}, ${accent}22)` }} />
      <div style={{ padding: "14px 16px 13px" }}>
        <Block width="52%" height={10} radius={6} style={{ marginBottom: 12 }} />
        <Block width="74%" height={24} radius={7} style={{ marginBottom: 8 }} />
        <Block width="38%" height={9} radius={6} />
      </div>
    </div>
  );
}

function Chart({ accent }) {
  return (
    <section className="app-loading-card">
      <div style={{ height: 3, background: `linear-gradient(90deg, ${accent}, transparent)` }} />
      <div style={{ padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, marginBottom: 18 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Block width="38%" height={15} radius={7} style={{ marginBottom: 8 }} />
            <Block width="28%" height={10} radius={6} />
          </div>
          <Block width={92} height={28} radius={8} />
        </div>
        <div
          className="app-loading-chart"
          style={{
            height: 194,
            borderRadius: 12,
            border: "1px solid #EEF2F6",
            background: "linear-gradient(180deg, #F8FAFC, #FFFFFF)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div style={{ position: "absolute", left: 16, right: 16, bottom: 31, height: 88, borderRadius: "80% 60% 0 0", borderTop: `3px solid ${accent}`, opacity: 0.35 }} />
          <div style={{ position: "absolute", left: 16, right: 16, bottom: 72, borderTop: "1px dashed #DDE5EC" }} />
          <div style={{ position: "absolute", left: 16, right: 16, bottom: 116, borderTop: "1px dashed #DDE5EC" }} />
        </div>
      </div>
    </section>
  );
}

function ActivityList() {
  return (
    <section className="app-loading-card" style={{ padding: 18 }}>
      <Block width="32%" height={14} radius={7} style={{ marginBottom: 16 }} />
      {[0, 1, 2, 3].map((item) => (
        <div
          key={item}
          style={{
            display: "grid",
            gridTemplateColumns: "42px minmax(0, 1fr) 72px",
            alignItems: "center",
            gap: 12,
            padding: item === 0 ? "0 0 14px" : "14px 0",
            borderTop: item === 0 ? "none" : "1px solid #F1F5F9",
          }}
        >
          <Block width={42} height={42} radius={11} />
          <div style={{ minWidth: 0 }}>
            <Block width="66%" height={12} radius={6} style={{ marginBottom: 8 }} />
            <Block width="42%" height={10} radius={6} />
          </div>
          <Block width={72} height={24} radius={8} />
        </div>
      ))}
    </section>
  );
}

export default function AppLoadingShell({
  title = "Loading Edgecipline",
  subtitle = "Preparing your trading workspace",
  market = "default",
  showHeader = true,
  showTicker = false,
  dense = false,
  fullPage = true,
}) {
  const colors = PALETTES[market] || PALETTES.default;

  if (dense) {
    return (
      <main
        className="app-loading-shell app-loading-shell-dense"
        aria-busy="true"
        aria-live="polite"
        role="status"
        style={{
          minHeight: fullPage ? "100dvh" : "auto",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background: fullPage ? colors.bg : "transparent",
          color: colors.ink,
          fontFamily: "'Plus Jakarta Sans', sans-serif",
        }}
      >
        <style>{`
          .app-loading-shell-dense,
          .app-loading-shell-dense * {
            box-sizing: border-box;
          }
          .app-loading-dense-mark {
            animation: appLoadingDensePulse 1.6s ease-in-out infinite;
            transform: translateZ(0);
          }
          @keyframes appLoadingDensePulse {
            0%, 100% { opacity: 0.74; transform: translateY(0) scale(1); }
            50% { opacity: 1; transform: translateY(-1px) scale(1.01); }
          }
          @media (prefers-reduced-motion: reduce) {
            .app-loading-dense-mark {
              animation: none !important;
            }
          }
        `}</style>
        <div style={{ textAlign: "center" }}>
          <Image
            className="app-loading-dense-mark"
            src="/mainlogo1.png"
            alt=""
            width="184"
            height="58"
            style={{ width: 184, maxWidth: "58vw", height: "auto", display: "block" }}
            priority
          />
          <span className="sr-only">
            {title}. {subtitle}.
          </span>
        </div>
      </main>
    );
  }

  return (
    <div
      className="app-loading-shell"
      aria-busy="true"
      aria-live="polite"
      role="status"
      style={{
        minHeight: fullPage ? "100dvh" : "auto",
        background: fullPage ? colors.bg : "transparent",
        color: colors.ink,
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}
    >
      <style>{`
        .app-loading-shell,
        .app-loading-shell * {
          box-sizing: border-box;
        }
        .app-loading-shimmer {
          animation: appLoadingShimmer 1.35s ease-in-out infinite;
        }
        .app-loading-card {
          background: ${colors.card};
          border: 1px solid ${colors.border};
          border-radius: 14px;
          box-shadow: 0 2px 14px rgba(15,25,35,0.045);
          overflow: hidden;
        }
        .app-loading-orbit {
          animation: appLoadingSpin 0.9s linear infinite;
        }
        @keyframes appLoadingShimmer {
          0% { background-position: 110% 0; }
          100% { background-position: -110% 0; }
        }
        @keyframes appLoadingSpin {
          to { transform: rotate(360deg); }
        }
        @keyframes appLoadingTape {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @media (max-width: 820px) {
          .app-loading-header {
            height: 58px !important;
            padding: 0 16px !important;
            padding-top: env(safe-area-inset-top) !important;
          }
          .app-loading-nav,
          .app-loading-actions,
          .app-loading-side {
            display: none !important;
          }
          .app-loading-main {
            padding: 16px 14px calc(96px + env(safe-area-inset-bottom)) !important;
          }
          .app-loading-kpis {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
          .app-loading-grid {
            grid-template-columns: 1fr !important;
          }
          .app-loading-chart {
            height: 172px !important;
          }
        }
        @media (max-width: 380px) {
          .app-loading-kpis {
            grid-template-columns: 1fr !important;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .app-loading-shimmer,
          .app-loading-orbit,
          .app-loading-tape > div {
            animation: none !important;
          }
        }
      `}</style>

      {showHeader && <Header colors={colors} showMarketTape={showTicker} />}

      <main
        className="app-loading-main"
        style={{
          maxWidth: dense ? 940 : 1180,
          margin: "0 auto",
          padding: showHeader ? "24px 20px 56px" : "8px 0 34px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 20 }}>
          <div style={{ minWidth: 0 }}>
            <Block width={dense ? 146 : 194} height={11} radius={6} style={{ marginBottom: 9 }} />
            <Block width={dense ? 226 : 306} height={24} radius={8} />
          </div>
          <div
            className="app-loading-orbit"
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              border: `3px solid ${colors.accent}24`,
              borderTopColor: colors.accent,
              flexShrink: 0,
            }}
            title={title}
          />
        </div>

        <div className="app-loading-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 16 }}>
          {[colors.accent, colors.accent2, colors.accent3, colors.danger].map((accent) => (
            <Kpi key={accent} accent={accent} />
          ))}
        </div>

        <div className="app-loading-grid" style={{ display: "grid", gridTemplateColumns: dense ? "1fr" : "minmax(0, 1.45fr) minmax(300px, 0.85fr)", gap: 16 }}>
          <Chart accent={colors.accent} />
          {!dense && (
            <div className="app-loading-side" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <ActivityList />
              <Chart accent={colors.accent2} />
            </div>
          )}
        </div>

        <span className="sr-only">
          {title}. {subtitle}.
        </span>
      </main>
    </div>
  );
}
