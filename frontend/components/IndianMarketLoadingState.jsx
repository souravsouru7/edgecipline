const C = {
  bull: "#0D9E6E",
  bear: "#D63B3B",
  gold: "#B8860B",
  blue: "#2563EB",
  ink: "#0F1923",
  muted: "#94A3B8",
  border: "#E2E8F0",
  bg: "#F4F2EE",
  card: "#FFFFFF",
};

function SkeletonBlock({ width = "100%", height = 12, radius = 8, style = {} }) {
  return (
    <div
      className="im-loading-shimmer"
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

function HeaderShell() {
  return (
    <header
      style={{
        height: 60,
        padding: "0 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "rgba(240,238,233,0.97)",
        borderBottom: `1px solid ${C.border}`,
        boxShadow: "0 1px 0 rgba(15,25,35,0.06)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <SkeletonBlock width={130} height={36} radius={8} />
        <SkeletonBlock width={58} height={12} radius={6} />
      </div>
      <nav className="im-loading-nav" style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {[74, 58, 72, 64, 56, 70].map((width, index) => (
          <SkeletonBlock key={index} width={width} height={12} radius={6} />
        ))}
      </nav>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <SkeletonBlock width={118} height={36} radius={18} />
        <SkeletonBlock width={38} height={36} radius={9} />
      </div>
    </header>
  );
}

function TickerShell() {
  return (
    <div style={{ overflow: "hidden", background: C.ink, borderBottom: `3px solid ${C.gold}`, padding: "7px 0" }}>
      <div style={{ display: "inline-flex", gap: 46, animation: "imLoadingTape 30s linear infinite" }}>
        {["NIFTY", "BANKNIFTY", "SENSEX", "FINNIFTY", "NSE", "BSE"].map((label) => (
          <span key={label} style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.04em", color: "#E8F5E9", whiteSpace: "nowrap" }}>
            {label} <span style={{ color: "#A5D6A7" }}>loading</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function KpiSkeleton({ accent = C.bull }) {
  return (
    <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden", boxShadow: "0 2px 8px rgba(15,25,35,0.04)" }}>
      <div style={{ height: 3, background: `linear-gradient(90deg, ${accent}, ${accent}22)` }} />
      <div style={{ padding: "14px 16px 12px" }}>
        <SkeletonBlock width="54%" height={10} radius={6} style={{ marginBottom: 12 }} />
        <SkeletonBlock width="72%" height={24} radius={7} style={{ marginBottom: 7 }} />
        <SkeletonBlock width="42%" height={9} radius={6} />
      </div>
    </div>
  );
}

function ChartSkeleton({ accent = C.bull }) {
  return (
    <section style={{ background: C.card, borderRadius: 14, border: `1px solid ${C.border}`, overflow: "hidden", boxShadow: "0 2px 12px rgba(15,25,35,0.04)" }}>
      <div style={{ height: 3, background: `linear-gradient(90deg, ${accent}, transparent)` }} />
      <div style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, marginBottom: 18 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <SkeletonBlock width="34%" height={15} radius={7} style={{ marginBottom: 8 }} />
            <SkeletonBlock width="24%" height={10} radius={6} />
          </div>
          <SkeletonBlock width={96} height={28} radius={8} />
        </div>
        <div style={{ height: 190, borderRadius: 12, border: "1px solid #EEF2F6", background: "linear-gradient(180deg, #F8FAFC, #FFFFFF)", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 18, right: 18, bottom: 28, height: 88, borderRadius: "80% 60% 0 0", borderTop: `3px solid ${accent}`, opacity: 0.32 }} />
          <div style={{ position: "absolute", left: 18, right: 18, bottom: 74, borderTop: "1px dashed #DDE5EC" }} />
          <div style={{ position: "absolute", left: 18, right: 18, bottom: 116, borderTop: "1px dashed #DDE5EC" }} />
        </div>
      </div>
    </section>
  );
}

function ListSkeleton() {
  return (
    <section style={{ background: C.card, borderRadius: 14, border: `1px solid ${C.border}`, padding: 18, boxShadow: "0 2px 12px rgba(15,25,35,0.04)" }}>
      <SkeletonBlock width="28%" height={14} radius={7} style={{ marginBottom: 16 }} />
      {[0, 1, 2, 3].map((item) => (
        <div key={item} style={{ display: "flex", alignItems: "center", gap: 12, padding: item === 0 ? "0 0 14px" : "14px 0", borderTop: item === 0 ? "none" : "1px solid #F1F5F9" }}>
          <SkeletonBlock width={42} height={42} radius={10} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <SkeletonBlock width="58%" height={12} radius={6} style={{ marginBottom: 8 }} />
            <SkeletonBlock width="34%" height={10} radius={6} />
          </div>
          <SkeletonBlock width={84} height={24} radius={8} />
        </div>
      ))}
    </section>
  );
}

export default function IndianMarketLoadingState({
  title = "Loading Indian Market",
  subtitle = "Preparing NSE / BSE workspace",
  showHeader = false,
  showTicker = false,
  dense = false,
}) {
  const ContentTag = showHeader ? "main" : "div";

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      style={{
        minHeight: showHeader ? "100vh" : "auto",
        background: showHeader ? C.bg : "transparent",
        color: C.ink,
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}
    >
      <style>{`
        .im-loading-shimmer::after {
          content: "";
          position: absolute;
          inset: 0;
          transform: translateX(-100%);
          background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.7) 50%, transparent 100%);
          animation: imLoadingShimmer 1.2s ease-in-out infinite;
        }
        @keyframes imLoadingShimmer {
          100% { transform: translateX(100%); }
        }
        @keyframes imLoadingSpin {
          to { transform: rotate(360deg); }
        }
        @keyframes imLoadingTape {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @media (max-width: 820px) {
          .im-loading-nav { display: none !important; }
          .im-loading-grid { grid-template-columns: 1fr !important; }
          .im-loading-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          .im-loading-side { display: none !important; }
        }
        @media (max-width: 520px) {
          .im-loading-kpis { grid-template-columns: 1fr !important; }
        }
      `}</style>

      {showHeader && <HeaderShell />}
      {showTicker && <TickerShell />}

      <ContentTag style={{ maxWidth: dense ? 900 : 1180, margin: "0 auto", padding: showHeader ? "24px 20px 56px" : "8px 0 34px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 20 }}>
          <div style={{ minWidth: 0 }}>
            <SkeletonBlock width={dense ? 150 : 210} height={11} radius={6} style={{ marginBottom: 9 }} />
            <SkeletonBlock width={dense ? 230 : 310} height={24} radius={8} />
          </div>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 12,
              border: "3px solid rgba(13,158,110,0.16)",
              borderTopColor: C.bull,
              animation: "imLoadingSpin 0.85s linear infinite",
              flexShrink: 0,
            }}
            title={title}
          />
        </div>

        <div className="im-loading-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 16 }}>
          {[C.bull, C.gold, C.blue, C.bear].map((accent) => (
            <KpiSkeleton key={accent} accent={accent} />
          ))}
        </div>

        <div className="im-loading-grid" style={{ display: "grid", gridTemplateColumns: dense ? "1fr" : "minmax(0, 1.45fr) minmax(300px, 0.85fr)", gap: 16 }}>
          <ChartSkeleton accent={C.bull} />
          <div className="im-loading-side" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <ListSkeleton />
            {!dense && <ChartSkeleton accent={C.gold} />}
          </div>
        </div>

        <span style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }}>
          {title}. {subtitle}.
        </span>
      </ContentTag>
    </div>
  );
}
