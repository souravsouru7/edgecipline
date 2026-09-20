"use client";

const DEFAULT_TICKERS = [
  { sym: "BTC",     val: "+2.34%", bull: true  },
  { sym: "ETH",     val: "-1.12%", bull: false },
  { sym: "AAPL",    val: "+0.87%", bull: true  },
  { sym: "TSLA",    val: "+4.20%", bull: true  },
  { sym: "NVDA",    val: "-0.55%", bull: false },
  { sym: "GOLD",    val: "+0.62%", bull: true  },
  { sym: "SPY",     val: "+0.31%", bull: true  },
  { sym: "OIL",     val: "-2.18%", bull: false },
  { sym: "AMZN",    val: "+1.05%", bull: true  },
  { sym: "USD/JPY", val: "-0.33%", bull: false },
];

// Indian-market pages show option contracts instead of global symbols.
export const INDIAN_TICKERS = [
  { sym: "NIFTY CE", val: "+2.1%", bull: true }, { sym: "NIFTY PE", val: "-1.4%", bull: false },
  { sym: "BANK NIFTY CE", val: "+1.8%", bull: true }, { sym: "BANK NIFTY PE", val: "+0.6%", bull: true },
  { sym: "FIN NIFTY CE", val: "-0.3%", bull: false }, { sym: "MIDCPNIFTY PE", val: "+1.2%", bull: true },
  { sym: "NIFTY CE", val: "+2.1%", bull: true }, { sym: "SENSEX CE", val: "+0.9%", bull: true },
];

/**
 * TickerTape
 * Dark scrolling bar with market ticker symbols.
 * Keyframe is self-contained so this works on every page without extra CSS.
 *
 * @param {object} [props]
 * @param {{ sym: string, val: string, bull: boolean }[]} [props.tickers]  rows to scroll; defaults to the global list
 * @param {string} [props.accent]       bottom border colour (admin pages use gold)
 * @param {number} [props.duration]     seconds per loop
 * @param {string} [props.symbolColor]
 * @param {string} [props.bullColor]
 * @param {string} [props.bearColor]
 */
export default function TickerTape({
  tickers = DEFAULT_TICKERS,
  accent = "#0D9E6E",
  duration = 32,
  symbolColor = "#94A3B8",
  bullColor = "#22C78E",
  bearColor = "#F87171",
}) {
  // Duplicate twice for seamless infinite loop
  const items = [...tickers, ...tickers];
  return (
    <>
      <style>{`
        @keyframes ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
      <div
        style={{
          overflow: "hidden", background: "#0F1923",
          borderBottom: `3px solid ${accent}`,
          padding: "7px 0", whiteSpace: "nowrap",
          position: "relative", zIndex: 10,
        }}
      >
        <div style={{ display: "inline-flex", gap: "48px", animation: `ticker-scroll ${duration}s linear infinite` }}>
          {items.map((t, i) => (
            <span key={i} style={{ fontSize: "11px", fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.04em" }}>
              <span style={{ color: symbolColor, marginRight: 6 }}>{t.sym}</span>
              <span style={{ color: t.bull ? bullColor : bearColor }}>
                {t.bull ? "▲" : "▼"} {t.val}
              </span>
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
