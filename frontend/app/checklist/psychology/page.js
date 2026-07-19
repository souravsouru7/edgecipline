"use client";

import { useState } from "react";
import Link from "next/link";

/* ─── design tokens ───────────────────────────────────── */
const G    = "#0D9E6E";
const R    = "#D63B3B";
const BG   = "#F0EEE9";
const CARD = "#FFFFFF";
const BDR  = "#E2E8F0";
const TXT  = "#0F1923";
const SUB  = "#475569";   // was #64748B — bumped up for readability
const FONT = "'Plus Jakarta Sans', sans-serif";
const MONO = "'JetBrains Mono', monospace";

/* ─── data ────────────────────────────────────────────── */
const PROBLEMS = [
  { id:1,  icon:"⚡", title:"Impulse Control",      tag:"IMPULSIVE",
    desc:"You act before thinking — enter without any plan",
    symptoms:["Random urge to enter trades","Click buy/sell before confirmation",'"Just one quick trade" mindset'],
    solutions:["5-Minute Delay before every entry","Full checklist before entering","Step away, reset, then decide","Hard max trades per day"] },
  { id:2,  icon:"😰", title:"Fear",                 tag:"FEARFUL",
    desc:"Loss aversion, FOMO and hesitation stop you cold",
    symptoms:["Skipping valid confirmed setups","Exiting winners way too early","Watching setups pass — never entering"],
    solutions:["Backtest your strategy — trust the data","Fixed risk % per trade, always","Treat missed trades as normal","Log missed setups to see the real cost"] },
  { id:3,  icon:"🔥", title:"Revenge Trading",      tag:"REVENGE",
    desc:"You trade immediately after a loss to recover it",
    symptoms:["New trade placed right after a loss","Doubling lot size to 'make it back'"],
    solutions:["Mandatory 15–30 min break after loss","Fixed lot size — no exceptions","Hard daily loss limit — stop when hit"] },
  { id:4,  icon:"👑", title:"Overconfidence",       tag:"EGO",
    desc:"A win streak inflates your ego and kills discipline",
    symptoms:["Ignoring your own rules after wins","Skipping the pre-trade checklist"],
    solutions:["Fixed position size every trade","Track behaviour, not just P&L","Long-term consistency over short wins"] },
  { id:5,  icon:"📊", title:"Overtrading",          tag:"OVERTRADING",
    desc:"You always need to be in a position",
    symptoms:["Trading every small candle move","Staying in market during off-hours"],
    solutions:["Hard max trades per day — stick to it","Fixed trading window only — log out after"] },
  { id:6,  icon:"🛑", title:"Loss Aversion",        tag:"AVOIDANCE",
    desc:"You cannot accept small losses — so they grow big",
    symptoms:["Moving stop-loss to avoid being stopped","Holding losing trades far too long"],
    solutions:["Set stop-loss before entry — never move it","Accept small losses as cost of trading"] },
  { id:7,  icon:"🧠", title:"Decision Paralysis",   tag:"FROZEN",
    desc:"Overthinking causes you to miss every entry",
    symptoms:["Staring at the same chart for hours","Stuck in an endless confirmation loop"],
    solutions:["Trade 1–2 setups only — master them","Written rules: if A → then B, no thinking"] },
  { id:8,  icon:"💔", title:"Emotional Dependency", tag:"EMOTIONAL",
    desc:"Your mood and identity are controlled by P&L",
    symptoms:["One losing trade ruins the entire day","Self-worth completely tied to trade outcome"],
    solutions:["Grade yourself on execution quality","Daily reflection log — separate you from results"] },
  { id:9,  icon:"⏱️", title:"Lack of Patience",    tag:"IMPATIENT",
    desc:"You force trades before the setup is fully ready",
    symptoms:["Entry before all conditions confirmed","Creating setups that simply aren't there"],
    solutions:["Wait for EVERY condition — zero exceptions","Cut screen time — less watching = less forcing"] },
  { id:10, icon:"🔀", title:"Inconsistency",        tag:"CHAOTIC",
    desc:"You use different rules every single session",
    symptoms:["Breaking your own rules 'just this once'","Applying different criteria every day"],
    solutions:["Written trading plan — print and pin it","Trade log — fill every session","Weekly review to catch pattern breaks"] },
];

/* ─── helpers ─────────────────────────────────────────── */
function VArrow({ color, height = 28 }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0 }}>
      <div style={{ width:2, height, background:color, opacity:0.5 }} />
      <div style={{ width:0, height:0,
        borderLeft:"5px solid transparent", borderRight:"5px solid transparent",
        borderTop:`7px solid ${color}`, opacity:0.65 }} />
    </div>
  );
}

function ProcessNode({ number, text, accent }) {
  return (
    <div style={{
      background:CARD, border:`1px solid ${BDR}`,
      borderLeft:`4px solid ${accent}`, borderRadius:12,
      padding:"14px 18px", display:"flex", alignItems:"flex-start", gap:14,
      boxShadow:"0 1px 8px rgba(15,25,35,0.05)",
    }}>
      <div style={{
        width:28, height:28, borderRadius:999, flexShrink:0,
        background:`${accent}18`, border:`1.5px solid ${accent}55`,
        display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:12, fontWeight:800, fontFamily:MONO, color:accent,
      }}>{number}</div>
      <span style={{ fontSize:14, fontWeight:600, color:TXT, lineHeight:1.6, fontFamily:FONT }}>{text}</span>
    </div>
  );
}

function DiamondNode() {
  return (
    <div style={{ display:"flex", justifyContent:"center" }}>
      <div style={{ position:"relative", width:148, height:148, flexShrink:0 }}>
        <div style={{
          position:"absolute", top:"18%", left:"18%",
          width:"64%", height:"64%",
          transform:"rotate(45deg)", background:CARD,
          border:`2px solid ${BDR}`, borderRadius:8,
          boxShadow:"0 6px 28px rgba(15,25,35,0.1)",
        }} />
        <div style={{
          position:"absolute", inset:0,
          display:"flex", flexDirection:"column",
          alignItems:"center", justifyContent:"center", textAlign:"center", gap:3,
        }}>
          <span style={{ fontSize:10, fontFamily:MONO, letterSpacing:"0.12em", color:SUB, fontWeight:700 }}>DID YOU</span>
          <span style={{ fontSize:10, fontFamily:MONO, letterSpacing:"0.12em", color:SUB, fontWeight:700 }}>APPLY THE</span>
          <span style={{ fontSize:12, fontFamily:MONO, letterSpacing:"0.12em", color:TXT, fontWeight:900 }}>FIX?</span>
        </div>
      </div>
    </div>
  );
}

/* Desktop T-branch — hidden on mobile via CSS */
function TBranch() {
  return (
    <div className="p-tbranch" style={{ position:"relative", width:"100%", height:72, flexShrink:0 }}>
      <div style={{ position:"absolute", left:"50%", top:0, width:2, height:"38%", background:BDR, transform:"translateX(-50%)" }} />
      <div style={{ position:"absolute", left:"25%", top:"38%", width:"50%", height:2, background:BDR }} />
      <div style={{ position:"absolute", left:"25%", top:"38%", width:2, height:"62%", background:`${R}55`, transform:"translateX(-50%)" }} />
      <div style={{ position:"absolute", left:"75%", top:"38%", width:2, height:"62%", background:`${G}55`, transform:"translateX(-50%)" }} />
      <div style={{ position:"absolute", left:"10%", top:"42%", padding:"3px 11px", borderRadius:999, background:`rgba(214,59,59,0.1)`, border:`1px solid rgba(214,59,59,0.3)`, fontSize:11, fontFamily:MONO, fontWeight:800, color:R, letterSpacing:"0.1em" }}>NO</div>
      <div style={{ position:"absolute", right:"10%", top:"42%", padding:"3px 11px", borderRadius:999, background:`rgba(13,158,110,0.1)`, border:`1px solid rgba(13,158,110,0.3)`, fontSize:11, fontFamily:MONO, fontWeight:800, color:G, letterSpacing:"0.1em" }}>YES</div>
    </div>
  );
}

/* Mobile split — vertical, shown only on mobile via CSS */
function MobileSplit() {
  return (
    <div className="p-mobile-split" style={{ display:"none", flexDirection:"column", alignItems:"center", gap:0 }}>
      <VArrow color={SUB} height={24} />
      <div style={{ display:"flex", gap:10, width:"100%" }}>
        <div style={{ flex:1, padding:"12px 14px", borderRadius:10, background:`rgba(214,59,59,0.08)`, border:`1px solid rgba(214,59,59,0.2)`, display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:16, color:R }}>✕</span>
          <span style={{ fontSize:12, fontFamily:MONO, fontWeight:800, color:R, letterSpacing:"0.08em" }}>NO — IGNORED</span>
        </div>
        <div style={{ flex:1, padding:"12px 14px", borderRadius:10, background:`rgba(13,158,110,0.08)`, border:`1px solid rgba(13,158,110,0.2)`, display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:16, color:G }}>✓</span>
          <span style={{ fontSize:12, fontFamily:MONO, fontWeight:800, color:G, letterSpacing:"0.08em" }}>YES — FIXED</span>
        </div>
      </div>
    </div>
  );
}

function OutcomeNode({ variant }) {
  const loop   = variant === "loop";
  const accent = loop ? R : G;
  const icon   = loop ? "↺" : "✓";
  const title  = loop ? "Cycle Repeats" : "Edge Built";
  const body   = loop
    ? "Same mistake keeps costing you — account slowly bleeds"
    : "Discipline compounds — consistency becomes your edge";
  return (
    <div style={{
      background:`${accent}0D`, border:`2px solid ${accent}40`,
      borderRadius:20, padding:"22px 20px", textAlign:"center",
      boxShadow: loop ? "none" : `0 4px 24px ${accent}20`,
    }}>
      <div style={{
        width:54, height:54, borderRadius:999,
        background:`${accent}18`, border:`2px solid ${accent}40`,
        display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:26, color:accent, margin:"0 auto 12px",
        animation: loop ? "slowSpin 5s linear infinite" : "none",
      }}>{icon}</div>
      <div style={{ fontSize:16, fontWeight:800, color:accent, marginBottom:6, fontFamily:FONT }}>{title}</div>
      <div style={{ fontSize:13, color:accent, lineHeight:1.6, opacity:0.8 }}>{body}</div>
    </div>
  );
}

/* ─── Flowchart view ──────────────────────────────────── */
function Flowchart({ problem, onBack, onNavigate }) {
  return (
    <div style={{ animation:"fadeUp 0.28s ease" }}>

      {/* Problem banner */}
      <div style={{
        background:CARD, border:`1px solid ${BDR}`, borderRadius:18,
        padding:"22px 24px", marginBottom:0,
        display:"flex", alignItems:"center", gap:18, flexWrap:"wrap",
        boxShadow:"0 2px 20px rgba(15,25,35,0.06)",
      }}>
        <div style={{
          width:64, height:64, borderRadius:16, flexShrink:0,
          background:BG, border:`1px solid ${BDR}`,
          display:"flex", alignItems:"center", justifyContent:"center", fontSize:32,
        }}>{problem.icon}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:11, fontFamily:MONO, letterSpacing:"0.18em", color:SUB, fontWeight:700, marginBottom:5 }}>
            PROBLEM {String(problem.id).padStart(2,"0")} · {problem.tag}
          </div>
          <h2 style={{ fontSize:"clamp(20px,4vw,30px)", fontWeight:900, color:TXT, margin:0, letterSpacing:"-0.02em" }}>
            {problem.title}
          </h2>
          <p style={{ fontSize:14, color:SUB, margin:"6px 0 0", lineHeight:1.6 }}>{problem.desc}</p>
        </div>
        <button onClick={onBack} style={{
          fontSize:12, fontFamily:MONO, letterSpacing:"0.08em", fontWeight:700,
          padding:"10px 16px", borderRadius:9, border:`1px solid ${BDR}`,
          background:BG, color:SUB, cursor:"pointer", flexShrink:0,
        }}>← BACK</button>
      </div>

      {/* Stem to diamond */}
      <div style={{ display:"flex", justifyContent:"center" }}>
        <VArrow color={SUB} height={28} />
      </div>

      <DiamondNode />
      <TBranch />
      <MobileSplit />

      {/* Path headers */}
      <div className="p-path-headers">
        <div style={{ padding:"16px 18px", borderRadius:12, background:`rgba(214,59,59,0.07)`, border:`1px solid rgba(214,59,59,0.22)`, display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:36, height:36, borderRadius:10, flexShrink:0, background:`rgba(214,59,59,0.15)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, color:R }}>✕</div>
          <div>
            <div style={{ fontSize:12, fontWeight:800, fontFamily:MONO, color:R, letterSpacing:"0.1em" }}>IF IGNORED</div>
            <div style={{ fontSize:12, color:SUB, marginTop:2, fontFamily:FONT }}>What keeps happening</div>
          </div>
        </div>
        <div style={{ padding:"16px 18px", borderRadius:12, background:`rgba(13,158,110,0.07)`, border:`1px solid rgba(13,158,110,0.22)`, display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:36, height:36, borderRadius:10, flexShrink:0, background:`rgba(13,158,110,0.15)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, color:G }}>✓</div>
          <div>
            <div style={{ fontSize:12, fontWeight:800, fontFamily:MONO, color:G, letterSpacing:"0.1em" }}>IF FIXED</div>
            <div style={{ fontSize:12, color:SUB, marginTop:2, fontFamily:FONT }}>What changes instead</div>
          </div>
        </div>
      </div>

      {/* Two-path steps */}
      <div className="p-step-cols" style={{ marginTop:14 }}>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
          {problem.symptoms.map((s, i) => (
            <div key={i} style={{ width:"100%", display:"flex", flexDirection:"column", alignItems:"center" }}>
              <ProcessNode number={i + 1} text={s} accent={R} />
              <VArrow color={R} height={i < problem.symptoms.length - 1 ? 18 : 26} />
            </div>
          ))}
          <OutcomeNode variant="loop" />
        </div>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
          {problem.solutions.map((s, i) => (
            <div key={i} style={{ width:"100%", display:"flex", flexDirection:"column", alignItems:"center" }}>
              <ProcessNode number={i + 1} text={s} accent={G} />
              <VArrow color={G} height={i < problem.solutions.length - 1 ? 18 : 26} />
            </div>
          ))}
          <OutcomeNode variant="win" />
        </div>
      </div>

      {/* Quick nav */}
      <div style={{
        marginTop:28, background:CARD, border:`1px solid ${BDR}`,
        borderRadius:14, padding:"20px 22px",
        boxShadow:"0 2px 10px rgba(15,25,35,0.04)",
      }}>
        <div style={{ fontSize:11, fontFamily:MONO, letterSpacing:"0.18em", color:SUB, fontWeight:700, marginBottom:14 }}>
          OTHER PROBLEMS
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {PROBLEMS.filter(p => p.id !== problem.id).map(p => (
            <button key={p.id} onClick={() => onNavigate(p)} style={{
              display:"inline-flex", alignItems:"center", gap:7,
              fontSize:13, fontWeight:700, fontFamily:FONT,
              padding:"9px 16px", borderRadius:999,
              border:`1px solid ${BDR}`, background:BG, color:TXT,
              cursor:"pointer", transition:"all 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor=`rgba(13,158,110,0.45)`; e.currentTarget.style.color=G; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor=BDR; e.currentTarget.style.color=TXT; }}
            >
              {p.icon} {p.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Problem grid view ───────────────────────────────── */
function ProblemGrid({ onSelect }) {
  const [hov, setHov] = useState(null);
  return (
    <div style={{ animation:"fadeUp 0.28s ease" }}>
      <div style={{ marginBottom:28 }}>
        <div style={{ fontSize:11, fontFamily:MONO, letterSpacing:"0.2em", color:SUB, fontWeight:700, marginBottom:12 }}>
          EDGEDISCIPLINE · PSYCHOLOGY GUIDE
        </div>
        <h1 style={{ fontSize:"clamp(26px,5vw,42px)", fontWeight:900, margin:0, letterSpacing:"-0.03em", color:TXT, lineHeight:1.1 }}>
          Trading Psychology
        </h1>
        <p style={{ fontSize:15, color:SUB, marginTop:10, lineHeight:1.7, maxWidth:520, fontFamily:FONT }}>
          Select any problem below to see its full{" "}
          <span style={{ fontWeight:700, color:R }}>if&nbsp;ignored</span> vs{" "}
          <span style={{ fontWeight:700, color:G }}>if&nbsp;fixed</span>{" "}
          flowchart with a decision diamond.
        </p>
      </div>

      {/* Legend strip */}
      <div className="p-legend" style={{ marginBottom:32 }}>

        {/* Step 1 */}
        <div style={{ flex:1, background:CARD, border:`1px solid ${BDR}`, borderRadius:16, padding:"20px 18px", display:"flex", flexDirection:"column", alignItems:"center", gap:14, boxShadow:"0 2px 12px rgba(15,25,35,0.05)", textAlign:"center" }}>
          <div style={{ width:48, height:26, borderRadius:999, border:`2px solid ${BDR}`, background:BG, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <div style={{ width:8, height:8, borderRadius:999, background:SUB, opacity:0.5 }} />
          </div>
          <div>
            <div style={{ fontSize:15, fontWeight:800, color:TXT, fontFamily:FONT, letterSpacing:"-0.01em", marginBottom:4 }}>Pick a Problem</div>
            <div style={{ fontSize:12, color:SUB, fontFamily:FONT, lineHeight:1.6 }}>Choose from 10 common trading psychology traps</div>
          </div>
        </div>

        <div className="p-legend-arrow">→</div>

        {/* Step 2 */}
        <div style={{ flex:1, background:CARD, border:`1px solid ${BDR}`, borderRadius:16, padding:"20px 18px", display:"flex", flexDirection:"column", alignItems:"center", gap:14, boxShadow:"0 2px 12px rgba(15,25,35,0.05)", textAlign:"center" }}>
          <div style={{ width:48, height:28, borderRadius:8, border:`2px solid ${BDR}`, background:BG, display:"flex", alignItems:"center", justifyContent:"center", gap:3 }}>
            <div style={{ width:20, height:3, borderRadius:999, background:BDR }} />
          </div>
          <div>
            <div style={{ fontSize:15, fontWeight:800, color:TXT, fontFamily:FONT, letterSpacing:"-0.01em", marginBottom:4 }}>Problem Identified</div>
            <div style={{ fontSize:12, color:SUB, fontFamily:FONT, lineHeight:1.6 }}>See what the problem looks like in your trading</div>
          </div>
        </div>

        <div className="p-legend-arrow">→</div>

        {/* Step 3 — Decision */}
        <div style={{ flex:1, background:CARD, border:`2px solid ${BDR}`, borderRadius:16, padding:"20px 18px", display:"flex", flexDirection:"column", alignItems:"center", gap:14, boxShadow:"0 4px 20px rgba(15,25,35,0.08)", textAlign:"center", position:"relative" }}>
          <div style={{ position:"relative", width:48, height:48, flexShrink:0 }}>
            <div style={{ position:"absolute", top:"15%", left:"15%", width:"70%", height:"70%", transform:"rotate(45deg)", background:BG, border:`2px solid ${BDR}`, borderRadius:4 }} />
            <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <span style={{ fontSize:13, fontFamily:MONO, fontWeight:900, color:TXT, letterSpacing:"0.06em" }}>?</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize:15, fontWeight:800, color:TXT, fontFamily:FONT, letterSpacing:"-0.01em", marginBottom:4 }}>Did You Apply the Fix?</div>
            <div style={{ fontSize:12, color:SUB, fontFamily:FONT, lineHeight:1.6 }}>A decision diamond splits the chart into two paths</div>
          </div>
        </div>

        <div className="p-legend-arrow">→</div>

        {/* Step 4 — two outcomes */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ background:`rgba(214,59,59,0.06)`, border:`1.5px solid rgba(214,59,59,0.28)`, borderRadius:14, padding:"15px 18px", display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:38, height:38, borderRadius:10, flexShrink:0, background:`rgba(214,59,59,0.12)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, color:R }}>✕</div>
            <div>
              <div style={{ fontSize:14, fontWeight:800, color:R, fontFamily:FONT, letterSpacing:"-0.01em" }}>Ignored Path</div>
              <div style={{ fontSize:12, color:R, fontFamily:FONT, opacity:0.75, marginTop:2 }}>Cycle repeats — same mistakes</div>
            </div>
          </div>
          <div style={{ background:`rgba(13,158,110,0.06)`, border:`1.5px solid rgba(13,158,110,0.28)`, borderRadius:14, padding:"15px 18px", display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:38, height:38, borderRadius:10, flexShrink:0, background:`rgba(13,158,110,0.12)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, color:G }}>✓</div>
            <div>
              <div style={{ fontSize:14, fontWeight:800, color:G, fontFamily:FONT, letterSpacing:"-0.01em" }}>Fixed Path</div>
              <div style={{ fontSize:12, color:G, fontFamily:FONT, opacity:0.75, marginTop:2 }}>Edge built — discipline grows</div>
            </div>
          </div>
        </div>

      </div>

      {/* Cards */}
      <div className="p-prob-grid">
        {PROBLEMS.map(p => {
          const active = hov === p.id;
          return (
            <button key={p.id} onClick={() => onSelect(p)}
              onMouseEnter={() => setHov(p.id)}
              onMouseLeave={() => setHov(null)}
              style={{
                background:CARD,
                border:`1px solid ${active ? "rgba(13,158,110,0.45)" : BDR}`,
                borderRadius:16, padding:"20px 18px", textAlign:"left",
                cursor:"pointer",
                boxShadow: active ? "0 6px 28px rgba(13,158,110,0.12)" : "0 2px 10px rgba(15,25,35,0.04)",
                transform: active ? "translateY(-3px)" : "translateY(0)",
                transition:"all 0.18s ease", position:"relative",
              }}
            >
              <div style={{ position:"absolute", top:14, right:16, fontSize:12, fontFamily:MONO, fontWeight:700, color:"rgba(15,25,35,0.18)" }}>
                {String(p.id).padStart(2,"0")}
              </div>
              <div style={{
                width:48, height:48, borderRadius:14, marginBottom:14,
                background:BG, border:`1px solid ${BDR}`,
                display:"flex", alignItems:"center", justifyContent:"center", fontSize:24,
                transform: active ? "scale(1.08)" : "scale(1)", transition:"transform 0.18s",
              }}>{p.icon}</div>
              <div style={{ fontSize:11, fontFamily:MONO, letterSpacing:"0.14em", color: active ? G : SUB, fontWeight:700, marginBottom:5, transition:"color 0.18s" }}>
                {p.tag}
              </div>
              <div style={{ fontSize:15, fontWeight:800, color:TXT, marginBottom:5, letterSpacing:"-0.01em", fontFamily:FONT }}>{p.title}</div>
              <div style={{ fontSize:13, color:SUB, lineHeight:1.6, fontFamily:FONT }}>{p.desc}</div>
              <div style={{ marginTop:14, fontSize:11, fontFamily:MONO, letterSpacing:"0.12em", fontWeight:700, color: active ? G : "#94A3B8", transition:"color 0.18s" }}>
                VIEW FLOWCHART →
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Root ────────────────────────────────────────────── */
export default function TradingPsychologyPage() {
  const [selected, setSelected] = useState(null);

  return (
    <div style={{ minHeight:"100vh", background:BG, fontFamily:FONT, color:TXT }}>

      {/* Header */}
      <header style={{
        position:"sticky", top:0, zIndex:100,
        padding:"12px 20px", minHeight:60,
        display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
        background:"rgba(240,238,233,0.96)", backdropFilter:"blur(20px)",
        borderBottom:`1px solid ${BDR}`,
        boxShadow:"0 1px 12px rgba(15,25,35,0.06)",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, minWidth:0 }}>
          <Link href="/checklist" style={{
            display:"inline-flex", alignItems:"center", gap:6,
            fontSize:12, fontFamily:MONO, letterSpacing:"0.08em", fontWeight:700,
            padding:"9px 14px", borderRadius:9,
            border:`1px solid ${BDR}`, background:CARD, color:SUB, textDecoration:"none",
            flexShrink:0,
          }}>← Checklist</Link>
          {selected && (
            <span style={{ fontSize:14, fontWeight:700, color:TXT, fontFamily:FONT, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              · {selected.icon} {selected.title}
            </span>
          )}
        </div>
        <div style={{
          fontSize:11, fontFamily:MONO, letterSpacing:"0.12em", fontWeight:700,
          padding:"7px 14px", borderRadius:999, flexShrink:0,
          border:`1px solid rgba(13,158,110,0.28)`,
          background:`rgba(13,158,110,0.08)`, color:G,
        }}>
          {selected ? "FLOWCHART" : "10 PATTERNS"}
        </div>
      </header>

      {/* Main */}
      <main style={{ width:"100%", maxWidth:1080, margin:"0 auto", padding:"28px 20px 100px" }}>
        {selected ? (
          <Flowchart
            problem={selected}
            onBack={() => setSelected(null)}
            onNavigate={p => { setSelected(null); setTimeout(() => setSelected(p), 10); }}
          />
        ) : (
          <ProblemGrid onSelect={setSelected} />
        )}
      </main>

      {/* Bottom bar */}
      <div style={{
        position:"fixed", bottom:0, left:0, right:0, zIndex:50,
        background:"rgba(240,238,233,0.97)", backdropFilter:"blur(16px)",
        borderTop:`1px solid ${BDR}`, padding:"14px 20px", textAlign:"center",
      }}>
        <span style={{ fontSize:14, fontWeight:800, fontFamily:FONT, letterSpacing:"-0.01em", color:TXT }}>
          Focus on <span style={{ color:G }}>discipline</span>, not <span style={{ color:R }}>emotion</span>
        </span>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap');

        * { box-sizing: border-box; }

        .p-path-headers {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          margin-bottom: 0;
        }
        .p-step-cols {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }
        .p-prob-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
          gap: 14px;
        }
        .p-legend {
          display: flex;
          align-items: stretch;
          gap: 10px;
        }
        .p-legend-arrow {
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          color: #CBD5E1;
          font-weight: 300;
          flex-shrink: 0;
          padding: 0 2px;
        }
        .p-tbranch { display: block; }
        .p-mobile-split { display: none !important; }

        @media (max-width: 600px) {
          .p-path-headers { grid-template-columns: 1fr; gap: 10px; }
          .p-step-cols { grid-template-columns: 1fr; gap: 24px; }
          .p-tbranch { display: none !important; }
          .p-mobile-split { display: flex !important; }
          .p-prob-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; }
          .p-legend { flex-direction: column; gap: 8px; }
          .p-legend-arrow { transform: rotate(90deg); font-size: 20px; align-self: center; padding: 0; }
        }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes slowSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
