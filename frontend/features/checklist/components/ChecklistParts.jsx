"use client";

import { useEffect, useState } from "react";
import { Check, CircleAlert, CircleCheck, CircleX, ImageOff, RotateCcw, X } from "lucide-react";
import { Button } from "@/features/shared/components/ui";

// Thresholds unchanged from the original page.
export function confidenceLevel(score) {
  if (score >= 80) return { key: "high", label: "A+ setup", sub: "All systems go. Execute with confidence.", Icon: CircleCheck };
  if (score >= 50) return { key: "moderate", label: "Moderate", sub: "Some rules not met. Proceed with caution.", Icon: CircleAlert };
  return { key: "low", label: "Low confidence", sub: "Most rules not met. Consider skipping this trade.", Icon: CircleX };
}

export function SetupPicker({ strategies, selectedIdx, onSelect }) {
  return (
    <div className="ec-check__setups" role="radiogroup" aria-label="Setup">
      {strategies.map((s, idx) => {
        const active = idx === selectedIdx;
        const count = (s.rules || []).filter((r) => r.label && r.label.trim()).length;
        return (
          <button
            key={s._id || idx}
            type="button"
            role="radio"
            aria-checked={active}
            className={`ec-check__setup ec-focusable${active ? " is-active" : ""}`}
            onClick={() => onSelect(idx)}
          >
            <span className="ec-check__setup-name">{s.name || "Unnamed setup"}</span>
            <span className="ec-check__setup-meta">{count} {count === 1 ? "rule" : "rules"}</span>
          </button>
        );
      })}
    </div>
  );
}

export function RuleList({ rules, checked, keyFor, onToggle }) {
  return (
    <ul className="ec-check__rules">
      {rules.map((rule, i) => {
        const key = keyFor(rule, i);
        const on = Boolean(checked[key]);
        return (
          <li key={key}>
            <button
              type="button"
              role="checkbox"
              aria-checked={on}
              className={`ec-check__rule ec-focusable${on ? " is-on" : ""}`}
              onClick={() => onToggle(key)}
            >
              <span className="ec-check__box" aria-hidden="true">{on && <Check size={15} strokeWidth={3} />}</span>
              <span className="ec-check__rule-text">{rule.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Thumb({ image, alt, onOpen }) {
  const [state, setState] = useState("loading");
  return (
    <button type="button" className="ec-check__thumb ec-focusable" onClick={onOpen} aria-label={alt}>
      {state === "error" ? (
        <span className="ec-check__thumb-error"><ImageOff size={16} aria-hidden="true" />Unavailable</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image.url} alt="" onLoad={() => setState("ok")} onError={() => setState("error")} style={{ opacity: state === "ok" ? 1 : 0 }} />
      )}
      {state === "loading" && <span className="ec-skeleton ec-check__thumb-skel" aria-hidden="true" />}
    </button>
  );
}

const MATCH_OPTIONS = [
  { value: "yes", label: "Yes", tone: "profit" },
  { value: "partly", label: "Partly", tone: "warning" },
  { value: "no", label: "No", tone: "loss" },
];

export function ReferenceImages({ setup, similarity, onSimilarity, onOpenImage }) {
  const images = Array.isArray(setup?.referenceImages) ? setup.referenceImages.slice(0, 5) : [];
  if (!images.length) return null;
  return (
    <section className="ec-check__refs" aria-label="Setup references">
      <div className="ec-check__refs-head">
        <h3>Compare with your reference charts</h3>
        <p>Your saved examples of this setup at its best.</p>
      </div>
      <div className="ec-check__thumbs">
        {images.map((image, i) => (
          <Thumb key={`${setup._id || setup.name}-${i}`} image={image} alt={`${setup.name} reference ${i + 1}`} onOpen={() => onOpenImage(image.url)} />
        ))}
      </div>
      <div className="ec-check__match">
        <span className="ec-check__match-q" id="ec-match-q">Does the live chart look like these?</span>
        <div className="ec-check__match-opts" role="radiogroup" aria-labelledby="ec-match-q">
          {MATCH_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={similarity === o.value}
              className={`ec-check__match-opt ec-check__match-opt--${o.tone} ec-focusable${similarity === o.value ? " is-on" : ""}`}
              onClick={() => onSimilarity(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ConfidencePanel({ score, checkedCount, totalRules, onTakeTrade, onReset, submitting, compact = false }) {
  const level = confidenceLevel(score);
  const LevelIcon = level.Icon;
  const canTrade = score >= 80;
  const primary = canTrade ? (
    <Button icon={<Check size={16} />} onClick={onTakeTrade} loading={submitting} block={!compact}>
      Take trade
    </Button>
  ) : (
    <Button variant="secondary" disabled block={!compact} aria-label={score >= 50 ? "Review your rules" : "Skip this trade"}>
      {score >= 50 ? "Review rules" : "Skip this trade"}
    </Button>
  );

  if (compact) {
    return (
      <div className={`ec-check__bar ec-check--${level.key}`} role="status" aria-live="polite">
        <div className="ec-check__bar-score">
          <span className="ec-check__bar-pct">{score}%</span>
          <span className="ec-check__bar-label">{level.label} · {checkedCount}/{totalRules}</span>
        </div>
        <button type="button" className="ec-check__bar-reset ec-focusable" onClick={onReset} aria-label="Reset all ticks">
          <RotateCcw size={16} />
        </button>
        {primary}
      </div>
    );
  }

  return (
    <section className={`ec-check__panel ec-card ec-check--${level.key}`} aria-label="Setup confidence">
      <p className="ec-dash__eyebrow">Setup confidence</p>
      <div className="ec-check__score-row">
        <span className="ec-check__score ec-num" aria-live="polite">{score}%</span>
        <span className="ec-check__count">{checkedCount} of {totalRules} rules</span>
      </div>
      <div className="ec-check__meter" role="progressbar" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100} aria-label="Rules checked">
        <span style={{ width: `${score}%` }} />
      </div>
      <div className="ec-check__verdict">
        <LevelIcon size={20} aria-hidden="true" />
        <div>
          <strong>{level.label}</strong>
          <span>{level.sub}</span>
        </div>
      </div>
      <div className="ec-check__actions">
        {primary}
        <Button variant="ghost" icon={<RotateCcw size={15} />} onClick={onReset} block>Reset</Button>
      </div>
    </section>
  );
}

export function ImageLightbox({ url, onClose }) {
  const [loaded, setLoaded] = useState(false);
  // Reset only when the image changes, not on every parent render.
  useEffect(() => { setLoaded(false); }, [url]);
  useEffect(() => {
    if (!url) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [url, onClose]);
  if (!url) return null;
  return (
    <div className="ec-check__lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label="Reference image">
      {/* Pinned to the viewport so it stays reachable however tall the image is. */}
      <button type="button" className="ec-check__lightbox-close" onClick={onClose} aria-label="Close preview">
        <X size={20} />
      </button>
      {!loaded && <span className="ec-check__lightbox-spin" aria-hidden="true" />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Reference" onLoad={() => setLoaded(true)} onClick={(e) => e.stopPropagation()} style={{ opacity: loaded ? 1 : 0 }} />
    </div>
  );
}
