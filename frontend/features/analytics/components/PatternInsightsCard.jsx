"use client";

// ── Constants ─────────────────────────────────────────────────────────────────

const C = {
  bull:    "#0D9E6E",
  bear:    "#D63B3B",
  gold:    "#B8860B",
  purple:  "#8B5CF6",
  primary: "#0F1923",
  muted:   "#94A3B8",
  border:  "#E2E8F0",
  card:    "#FFFFFF",
  warning: "#F59E0B",
  info:    "#3B82F6",
};

// ── Small helpers ─────────────────────────────────────────────────────────────

function fmt(n) {
  const v = parseFloat(n || 0);
  return `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`;
}

function confidencePill(level) {
  const map = {
    High:   { bg: "#DCFCE7", color: "#166534" },
    Medium: { bg: "#FEF9C3", color: "#854D0E" },
    Low:    { bg: "#FEE2E2", color: "#991B1B" },
  };
  const style = map[level] || { bg: "#F1F5F9", color: "#475569" };
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
      background: style.bg, color: style.color, fontFamily: "'JetBrains Mono',monospace",
      textTransform: "uppercase", letterSpacing: "0.05em",
    }}>
      {level}
    </span>
  );
}

// Rank alone does not earn a color: the "best" bucket is still a losing one
// when every bucket loses money, so green requires actual profit.
function rowAccent({ isBest, isWorst, netPnl }) {
  const v = parseFloat(netPnl || 0);
  if (isBest && v > 0) return C.bull;
  if (isWorst && v < 0) return C.bear;
  return C.muted;
}

function PnLBadge({ netPnl }) {
  const v = parseFloat(netPnl || 0);
  return (
    <span style={{
      fontSize: 12, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace",
      color: v >= 0 ? C.bull : C.bear,
    }}>
      {fmt(v)}
    </span>
  );
}

// ── Pattern Row ────────────────────────────────────────────────────────────────

function PatternRow({ label, winRate, netPnl, count, confidence, accent }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "10px 0", borderBottom: `1px solid ${C.border}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 600, color: C.primary,
          fontFamily: "'Plus Jakarta Sans',sans-serif",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {label}
        </div>
        <div style={{ fontSize: 10, color: C.muted, marginTop: 2, display: "flex", gap: 6, alignItems: "center" }}>
          <span>{count} trades</span>
          <span>·</span>
          <span style={{ color: accent }}>{winRate}% WR</span>
          {confidence && <span>·</span>}
          {confidence && confidencePill(confidence)}
        </div>
      </div>
      <PnLBadge netPnl={netPnl} />
    </div>
  );
}

// ── Streak Mini Card ──────────────────────────────────────────────────────────

function StreakBlock({ label, stats, accent }) {
  if (!stats) return null;
  return (
    <div style={{
      background: `${accent}10`, border: `1px solid ${accent}30`,
      borderRadius: 8, padding: "8px 12px", flex: "1 1 120px", minWidth: 100,
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace", color: accent }}>
        {stats.winRate}%
      </div>
      <div style={{ fontSize: 10, color: C.muted }}>Win Rate</div>
      <div style={{ fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: parseFloat(stats.netPnl) >= 0 ? C.bull : C.bear, marginTop: 2 }}>
        {fmt(stats.netPnl)}
      </div>
      <div style={{ fontSize: 9, color: C.muted }}>{stats.count} trades · {stats.confidence}</div>
    </div>
  );
}

// ── Section Header ────────────────────────────────────────────────────────────

function SectionHeading({ icon, title, subtitle }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.primary, fontFamily: "'Plus Jakarta Sans',sans-serif" }}>{title}</span>
      </div>
      {subtitle && <div style={{ fontSize: 10, color: C.muted, fontFamily: "'JetBrains Mono',monospace" }}>{subtitle}</div>}
    </div>
  );
}

// ── Card Wrapper ──────────────────────────────────────────────────────────────

function Card({ children, accentColor = C.primary, delay = 0 }) {
  return (
    <div style={{
      background: C.card, borderRadius: 14, border: `1px solid ${C.border}`,
      overflow: "hidden", boxShadow: "0 2px 12px rgba(15,25,35,0.05)",
      animation: `fadeUp 0.5s ease ${delay}s both`,
    }}>
      <div style={{ height: 3, background: `linear-gradient(90deg, ${accentColor}, ${accentColor}22)` }} />
      <div style={{ padding: "16px 20px" }}>{children}</div>
    </div>
  );
}

// ── Insight Banner ────────────────────────────────────────────────────────────

function InsightBanner({ text, color = C.info }) {
  if (!text) return null;
  return (
    <div style={{
      background: `${color}10`, border: `1px solid ${color}30`,
      borderRadius: 8, padding: "8px 12px", marginTop: 10,
      fontSize: 11, color: C.primary, lineHeight: 1.5,
      fontFamily: "'Plus Jakarta Sans',sans-serif",
    }}>
      <span style={{ color, fontWeight: 700 }}>Insight: </span>{text}
    </div>
  );
}

// ── Not Enough Data ───────────────────────────────────────────────────────────

function NotEnoughData({ message }) {
  return (
    <div style={{
      textAlign: "center", padding: "32px 20px",
      color: C.muted, fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif",
    }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>🔍</div>
      <div style={{ fontWeight: 600, color: C.primary, marginBottom: 4 }}>No Patterns Yet</div>
      <div>{message || "Log more trades to start discovering your behavioral patterns."}</div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

/**
 * PatternInsightsCard
 *
 * Renders the full Pattern Detection Engine output as a dashboard section.
 *
 * @param {object} patterns   Output from GET /analytics/patterns
 * @param {number} delay      CSS animation delay
 */
export default function PatternInsightsCard({ patterns, delay = 0 }) {
  if (!patterns || patterns.insufficient) {
    return (
      <Card accentColor={C.purple} delay={delay}>
        <SectionHeading icon="🧬" title="Pattern Detection" subtitle="BEHAVIORAL PATTERN ANALYSIS" />
        <NotEnoughData message={patterns?.message} />
      </Card>
    );
  }

  const { lossStreaks, winStreaks, confidence, mood, emotions, sessions, dayOfWeek, setupScore, ruleViolations, combinations, rankings, summary } = patterns;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Top Summary Row ── */}
      {(summary?.topPositivePattern || summary?.topNegativePattern) && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {summary.topPositivePattern && (
            <Card accentColor={C.bull} delay={delay}>
              <SectionHeading icon="✅" title="Top Positive Pattern" subtitle={`${summary.topPositivePattern.confidence?.toUpperCase()} CONFIDENCE · ${summary.topPositivePattern.count} TRADES`} />
              <div style={{ fontSize: 16, fontWeight: 700, color: C.primary, fontFamily: "'Plus Jakarta Sans',sans-serif", marginBottom: 6 }}>
                {summary.topPositivePattern.description}
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.bull, fontFamily: "'JetBrains Mono',monospace" }}>
                    +{summary.topPositivePattern.netPnl?.toFixed?.(2) ?? summary.topPositivePattern.netPnl}
                  </div>
                  <div style={{ fontSize: 9, color: C.muted, textTransform: "uppercase" }}>Net P&L</div>
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.bull, fontFamily: "'JetBrains Mono',monospace" }}>
                    {summary.topPositivePattern.winRate}%
                  </div>
                  <div style={{ fontSize: 9, color: C.muted, textTransform: "uppercase" }}>Win Rate</div>
                </div>
              </div>
            </Card>
          )}
          {summary.topNegativePattern && (
            <Card accentColor={C.bear} delay={delay + 0.05}>
              <SectionHeading icon="⚠️" title="Top Negative Pattern" subtitle={`${summary.topNegativePattern.confidence?.toUpperCase()} CONFIDENCE · ${summary.topNegativePattern.count} TRADES`} />
              <div style={{ fontSize: 16, fontWeight: 700, color: C.primary, fontFamily: "'Plus Jakarta Sans',sans-serif", marginBottom: 6 }}>
                {summary.topNegativePattern.description}
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.bear, fontFamily: "'JetBrains Mono',monospace" }}>
                    {summary.topNegativePattern.netPnl?.toFixed?.(2) ?? summary.topNegativePattern.netPnl}
                  </div>
                  <div style={{ fontSize: 9, color: C.muted, textTransform: "uppercase" }}>Net P&L</div>
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.bear, fontFamily: "'JetBrains Mono',monospace" }}>
                    {summary.topNegativePattern.winRate}%
                  </div>
                  <div style={{ fontSize: 9, color: C.muted, textTransform: "uppercase" }}>Win Rate</div>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── Streak Patterns ── */}
      {(lossStreaks || winStreaks) && (
        <Card accentColor={C.bear} delay={delay + 0.1}>
          <SectionHeading icon="🔴" title="Consecutive Loss Patterns" subtitle="HOW LOSS STREAKS AFFECT YOUR NEXT TRADE" />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <StreakBlock label="After 1 Loss"  stats={lossStreaks?.after1Loss}      accent={C.warning} />
            <StreakBlock label="After 2 Losses" stats={lossStreaks?.after2Losses}   accent={C.bear} />
            <StreakBlock label="After 3 Losses" stats={lossStreaks?.after3Losses}   accent={C.bear} />
            <StreakBlock label="After 4+ Losses" stats={lossStreaks?.after4PlusLosses} accent="#7F1D1D" />
          </div>
          {lossStreaks?.insight && <InsightBanner text={lossStreaks.insight} color={C.bear} />}

          {winStreaks && (
            <>
              <div style={{ height: 1, background: C.border, margin: "16px 0" }} />
              <SectionHeading icon="🟢" title="Consecutive Win Patterns" subtitle="OVERCONFIDENCE DETECTION" />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <StreakBlock label="After 1 Win"  stats={winStreaks?.after1Win}     accent={C.bull} />
                <StreakBlock label="After 2 Wins" stats={winStreaks?.after2Wins}    accent={C.bull} />
                <StreakBlock label="After 3 Wins" stats={winStreaks?.after3Wins}    accent={C.gold} />
                <StreakBlock label="After 4+ Wins" stats={winStreaks?.after4PlusWins} accent={C.gold} />
              </div>
              {winStreaks?.overconfidenceDetected && winStreaks?.insight && (
                <InsightBanner text={winStreaks.insight} color={C.gold} />
              )}
            </>
          )}
        </Card>
      )}

      {/* ── Combination Patterns (Most Important) ── */}
      {combinations && (combinations.topPositive?.length > 0 || combinations.topNegative?.length > 0) && (
        <Card accentColor={C.purple} delay={delay + 0.15}>
          <SectionHeading icon="🔮" title="Combination Patterns" subtitle="MULTI-FACTOR BEHAVIORAL DISCOVERY" />
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {combinations.topPositive?.length > 0 && (
              <div style={{ flex: "1 1 200px", minWidth: 180 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.bull, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                  Most Profitable
                </div>
                {combinations.topPositive.map((c, i) => (
                  <PatternRow
                    key={i}
                    label={c.label}
                    winRate={c.winRate}
                    netPnl={c.netPnl}
                    count={c.count}
                    confidence={c.confidence}
                    accent={C.bull}
                  />
                ))}
              </div>
            )}
            {combinations.topNegative?.length > 0 && (
              <div style={{ flex: "1 1 200px", minWidth: 180 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.bear, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                  Most Dangerous
                </div>
                {combinations.topNegative.map((c, i) => (
                  <PatternRow
                    key={i}
                    label={c.label}
                    winRate={c.winRate}
                    netPnl={c.netPnl}
                    count={c.count}
                    confidence={c.confidence}
                    accent={C.bear}
                  />
                ))}
              </div>
            )}
          </div>
          {combinations.insight && <InsightBanner text={combinations.insight} color={C.purple} />}
        </Card>
      )}

      {/* ── Emotion + Confidence + Mood Row ── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>

        {/* Emotions */}
        {emotions?.byTag?.length > 0 && (
          <Card accentColor={C.bear} delay={delay + 0.2}>
            <SectionHeading icon="😤" title="Emotional Tag Patterns" subtitle="IMPACT ON PERFORMANCE" />
            {emotions.byTag.map((e, i) => (
              <PatternRow
                key={i}
                label={`${e.tag} (${e.type})`}
                winRate={e.winRate}
                netPnl={e.netPnl}
                count={e.count}
                confidence={e.confidence}
                accent={e.type === "negative" ? C.bear : C.bull}
              />
            ))}
            {emotions.insight && <InsightBanner text={emotions.insight} color={C.bear} />}
          </Card>
        )}

        {/* Confidence Ranges */}
        {confidence?.byRange?.length > 0 && (
          <Card accentColor={C.gold} delay={delay + 0.22}>
            <SectionHeading icon="🎯" title="Confidence Patterns" subtitle="HOW YOUR CONFIDENCE LEVEL SCORES" />
            {confidence.byRange.map((r, i) => (
              <PatternRow
                key={i}
                label={r.label || `Confidence ${r.range}`}
                winRate={r.winRate}
                netPnl={r.netPnl}
                count={r.count}
                confidence={r.confidence}
                accent={rowAccent({ isBest: r.range === confidence.bestRange, isWorst: r.range === confidence.worstRange, netPnl: r.netPnl })}
              />
            ))}
            {confidence.insight && <InsightBanner text={confidence.insight} color={C.gold} />}
          </Card>
        )}

        {/* Mood */}
        {mood?.byMood?.length > 0 && (
          <Card accentColor={C.info} delay={delay + 0.24}>
            <SectionHeading icon="🧠" title="Mood Patterns" subtitle="MOOD STATE VS PERFORMANCE" />
            {mood.byMood.map((m, i) => (
              <PatternRow
                key={i}
                label={`${m.label} mood (${m.mood}/5)`}
                winRate={m.winRate}
                netPnl={m.netPnl}
                count={m.count}
                confidence={m.confidence}
                accent={rowAccent({ isBest: m.mood === mood.bestMood?.mood, isWorst: m.mood === mood.worstMood?.mood, netPnl: m.netPnl })}
              />
            ))}
            {mood.insight && <InsightBanner text={mood.insight} color={C.info} />}
          </Card>
        )}
      </div>

      {/* ── Session + Day of Week Row ── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>

        {/* Session */}
        {sessions?.bySessions?.length > 0 && (
          <Card accentColor={C.bull} delay={delay + 0.28}>
            <SectionHeading icon="⏰" title="Session Patterns" subtitle="BEST & WORST TRADING SESSIONS" />
            {sessions.bySessions.map((s, i) => (
              <PatternRow
                key={i}
                label={s.session}
                winRate={s.winRate}
                netPnl={s.netPnl}
                count={s.count}
                confidence={s.confidence}
                accent={rowAccent({ isBest: s.session === sessions.bestSession?.session, isWorst: s.session === sessions.worstSession?.session, netPnl: s.netPnl })}
              />
            ))}
            {sessions.insight && <InsightBanner text={sessions.insight} color={C.bull} />}
          </Card>
        )}

        {/* Day of Week */}
        {dayOfWeek?.byDay?.length > 0 && (
          <Card accentColor={C.purple} delay={delay + 0.3}>
            <SectionHeading icon="📅" title="Day of Week Patterns" subtitle="BEST & WORST TRADING DAYS" />
            {dayOfWeek.byDay.map((d, i) => (
              <PatternRow
                key={i}
                label={d.day}
                winRate={d.winRate}
                netPnl={d.netPnl}
                count={d.count}
                confidence={d.confidence}
                accent={rowAccent({ isBest: d.day === dayOfWeek.bestDay?.day, isWorst: d.day === dayOfWeek.worstDay?.day, netPnl: d.netPnl })}
              />
            ))}
            {dayOfWeek.insight && <InsightBanner text={dayOfWeek.insight} color={C.purple} />}
          </Card>
        )}
      </div>

      {/* ── Setup Score + Rule Violations Row ── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>

        {/* Setup Score */}
        {setupScore?.byRange?.length > 0 && (
          <Card accentColor={C.gold} delay={delay + 0.34}>
            <SectionHeading icon="📊" title="Setup Score Patterns" subtitle="WHICH SETUP QUALITY PAYS YOU" />
            {setupScore.byRange.map((r, i) => (
              <PatternRow
                key={i}
                label={r.label || `Setup Score ${r.range}`}
                winRate={r.winRate}
                netPnl={r.netPnl}
                count={r.count}
                confidence={r.confidence}
                accent={rowAccent({ isBest: r.range === setupScore.optimalThreshold, isWorst: r.range === setupScore.worstRange, netPnl: r.netPnl })}
              />
            ))}
            {setupScore.insight && <InsightBanner text={setupScore.insight} color={C.gold} />}
          </Card>
        )}

        {/* Rule Violations */}
        {ruleViolations?.byRule?.length > 0 && (
          <Card accentColor={C.bear} delay={delay + 0.36}>
            <SectionHeading icon="🚨" title="Rule Violation Costs" subtitle="BROKEN RULES & THEIR PRICE" />
            {ruleViolations.byRule.map((r, i) => (
              <div key={i} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 0", borderBottom: `1px solid ${C.border}`,
              }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.primary, fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
                    {r.rule}
                  </div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                    Broken {r.brokenCount}× · avg {r.avgCost} per violation · {confidencePill(r.confidence)}
                  </div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: C.bear }}>
                  {r.totalCost}
                </span>
              </div>
            ))}
            {ruleViolations.insight && <InsightBanner text={ruleViolations.insight} color={C.bear} />}
          </Card>
        )}
      </div>

      {/* ── Pattern Rankings ── */}
      {(rankings?.top5Positive?.length > 0 || rankings?.top5Negative?.length > 0) && (
        <Card accentColor={C.primary} delay={delay + 0.4}>
          <SectionHeading icon="🏆" title="Pattern Rankings" subtitle="RANKED BY STATISTICAL SIGNIFICANCE × P&L IMPACT" />
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {rankings.top5Positive?.length > 0 && (
              <div style={{ flex: "1 1 200px", minWidth: 180 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.bull, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                  Top 5 Positive Patterns
                </div>
                {rankings.top5Positive.map((p, i) => (
                  <PatternRow
                    key={i}
                    label={p.description || p.name}
                    winRate={p.winRate}
                    netPnl={p.netPnl}
                    count={p.count}
                    confidence={p.confidence}
                    accent={C.bull}
                  />
                ))}
              </div>
            )}
            {rankings.top5Negative?.length > 0 && (
              <div style={{ flex: "1 1 200px", minWidth: 180 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.bear, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                  Top 5 Negative Patterns
                </div>
                {rankings.top5Negative.map((p, i) => (
                  <PatternRow
                    key={i}
                    label={p.description || p.name}
                    winRate={p.winRate}
                    netPnl={p.netPnl}
                    count={p.count}
                    confidence={p.confidence}
                    accent={C.bear}
                  />
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

    </div>
  );
}
