"use client";

import { useEffect, useState } from "react";
import AdminHeader from "@/components/AdminHeader";
import {
  getPromotionOverview,
  getPromotionCampaigns,
  createPromotionCampaign,
  updatePromotionCampaign,
  getPromotionCoupons,
  createPromotionCoupon,
  updatePromotionCoupon,
  getPromotionInfluencers,
  createPromotionInfluencer,
  updatePromotionInfluencer,
  getPromotionRedemptions,
} from "@/services/adminApi";

const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #E2E8F0",
  borderRadius: 8,
  fontSize: 13,
};

const labelStyle = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontWeight: 700, color: "#64748B" };

const PLAN_TYPES = ["monthly", "3_months", "6_months"];

const EMPTY_CAMPAIGN = { name: "", type: "general", status: "active", startsAt: "", endsAt: "", influencerId: "" };
const EMPTY_COUPON = {
  code: "",
  campaignId: "",
  discountType: "percent",
  discountValue: 20,
  startsAt: "",
  expiresAt: "",
  maxRedemptions: "",
  maxPerUser: 1,
  minAmount: "",
  applicablePlanTypes: [],
  firstTimePayerOnly: false,
  excludeActiveSubscribers: false,
};

// <input type="datetime-local"> works in the admin's local time; the API
// stores UTC, so convert on the way out and back.
function toLocalInput(value) {
  if (!value) return "";
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(value) {
  return value ? new Date(value).toISOString() : undefined;
}
function formatWhen(value) {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}
function couponToForm(c) {
  return {
    code: c.codeDisplay || c.codeNormalized,
    campaignId: c.campaign?._id || c.campaign || "",
    discountType: c.discountType,
    discountValue: c.discountValue,
    startsAt: toLocalInput(c.startsAt),
    expiresAt: toLocalInput(c.expiresAt),
    maxRedemptions: c.maxRedemptions ?? "",
    maxPerUser: c.maxPerUser ?? 1,
    minAmount: c.minAmount || "",
    applicablePlanTypes: c.applicablePlanTypes || [],
    firstTimePayerOnly: Boolean(c.firstTimePayerOnly),
    excludeActiveSubscribers: Boolean(c.excludeActiveSubscribers),
  };
}
// What the API accepts. Empty numeric fields are sent as "" (create: ignored;
// update: maxRedemptions "" clears the cap), everything else as real numbers.
function couponPayload(form, { forUpdate = false } = {}) {
  const num = (v) => (v === "" || v == null ? "" : Number(v));
  const body = {
    code: form.code.trim(),
    campaignId: form.campaignId,
    discountType: form.discountType,
    discountValue: Number(form.discountValue),
    startsAt: fromLocalInput(form.startsAt),
    expiresAt: fromLocalInput(form.expiresAt),
    maxRedemptions: num(form.maxRedemptions),
    maxPerUser: num(form.maxPerUser),
    minAmount: num(form.minAmount),
    applicablePlanTypes: form.applicablePlanTypes,
    firstTimePayerOnly: form.firstTimePayerOnly,
    excludeActiveSubscribers: form.excludeActiveSubscribers,
  };
  if (!forUpdate) {
    for (const k of ["maxRedemptions", "maxPerUser", "minAmount"]) if (body[k] === "") delete body[k];
  } else {
    if (body.maxPerUser === "") delete body.maxPerUser;
    if (body.minAmount === "") body.minAmount = 0;
    // Clearing a date must reach the API as "" (not undefined) to unset it.
    body.startsAt = form.startsAt ? body.startsAt : "";
    body.expiresAt = form.expiresAt ? body.expiresAt : "";
  }
  return body;
}
function describeRules(c) {
  const parts = [];
  if (c.applicablePlanTypes?.length) parts.push(c.applicablePlanTypes.join("/"));
  if (c.minAmount > 0) parts.push(`min ₹${c.minAmount}`);
  if (c.maxPerUser && c.maxPerUser !== 1) parts.push(`${c.maxPerUser}/user`);
  if (c.firstTimePayerOnly) parts.push("first payment only");
  if (c.excludeActiveSubscribers || c.newPurchaseOnly) parts.push("not for active subscribers");
  return parts.length ? parts.join(" · ") : "—";
}

export default function AdminPromotionsPage() {
  const [overview, setOverview] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [influencers, setInfluencers] = useState([]);
  const [redemptions, setRedemptions] = useState([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");

  const [campaignForm, setCampaignForm] = useState(EMPTY_CAMPAIGN);
  const [couponForm, setCouponForm] = useState(EMPTY_COUPON);
  const [editingCouponId, setEditingCouponId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [influencerForm, setInfluencerForm] = useState({ name: "", slug: "" });

  // Toggles used to swallow failures (a 429 or 400 left the old value on
  // screen with nothing said). Every mutation now reports through `error`.
  const mutate = async (fn) => {
    try {
      setError("");
      await fn();
      await reload();
    } catch (err) {
      setError(err.message || "Request failed");
    }
  };

  const reload = async () => {
    try {
      const [ov, camps, coups, infs, reds] = await Promise.all([
        getPromotionOverview(),
        getPromotionCampaigns(),
        getPromotionCoupons(),
        getPromotionInfluencers(),
        getPromotionRedemptions(),
      ]);
      setOverview(ov);
      setCampaigns(camps?.campaigns || []);
      setCoupons(coups?.coupons || []);
      setInfluencers(infs?.influencers || []);
      setRedemptions(reds?.redemptions || []);
    } catch (err) {
      setError(err.message || "Failed to load promotions");
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const kpis = [
    ["Campaigns", overview?.totalCampaigns],
    ["Active", overview?.activeCampaigns],
    ["Paid redemptions", overview?.totalCouponUsage],
    ["Paid users", overview?.paidConversions],
    ["Promo revenue", overview?.revenue != null ? `₹${overview.revenue}` : "—"],
    ["Discount given", overview?.discountAmount != null ? `₹${overview.discountAmount}` : "—"],
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#F0EEE9", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <AdminHeader title="Promotions" subtitle="Campaigns, coupons, and influencer attribution" />
      <div style={{ padding: 28, maxWidth: 1200, margin: "0 auto" }}>
        {error && (
          <div style={{ background: "#FEF2F2", color: "#D63B3B", padding: 12, borderRadius: 10, marginBottom: 16, fontWeight: 600 }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {["overview", "campaigns", "coupons", "influencers", "redemptions"].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{
                padding: "8px 14px",
                borderRadius: 999,
                border: tab === t ? "none" : "1px solid #E2E8F0",
                background: tab === t ? "#0F1923" : "#fff",
                color: tab === t ? "#fff" : "#475569",
                fontWeight: 700,
                fontSize: 12,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                cursor: "pointer",
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            {kpis.map(([label, value]) => (
              <div key={label} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: 16 }}>
                <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 700 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{value ?? "—"}</div>
              </div>
            ))}
          </div>
        )}

        {tab === "campaigns" && (
          <section>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const name = campaignForm.name.trim();
                if (!name) {
                  setError("Campaign name is required");
                  return;
                }
                try {
                  setError("");
                  await createPromotionCampaign({
                    name,
                    type: campaignForm.type,
                    status: campaignForm.status,
                    startsAt: fromLocalInput(campaignForm.startsAt),
                    endsAt: fromLocalInput(campaignForm.endsAt),
                    influencerId: campaignForm.influencerId || undefined,
                  });
                  setCampaignForm(EMPTY_CAMPAIGN);
                  await reload();
                } catch (err) {
                  setError(err.message || "Could not create campaign");
                }
              }}
              style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 16 }}
            >
              <input style={inputStyle} required placeholder="Campaign name" value={campaignForm.name} onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })} />
              <select style={inputStyle} value={campaignForm.type} onChange={(e) => setCampaignForm({ ...campaignForm, type: e.target.value })}>
                <option value="general">general</option>
                <option value="festival">festival</option>
                <option value="influencer">influencer</option>
                <option value="new_user">new_user</option>
                <option value="other">other</option>
              </select>
              <select style={inputStyle} value={campaignForm.status} onChange={(e) => setCampaignForm({ ...campaignForm, status: e.target.value })}>
                <option value="draft">draft</option>
                <option value="active">active</option>
                <option value="paused">paused</option>
                <option value="ended">ended</option>
              </select>
              <select style={inputStyle} value={campaignForm.influencerId} onChange={(e) => setCampaignForm({ ...campaignForm, influencerId: e.target.value })}>
                <option value="">No influencer</option>
                {influencers.map((i) => (
                  <option key={i._id} value={i._id}>{i.name}</option>
                ))}
              </select>
              <label style={labelStyle}>Starts<input style={inputStyle} type="datetime-local" value={campaignForm.startsAt} onChange={(e) => setCampaignForm({ ...campaignForm, startsAt: e.target.value })} /></label>
              <label style={labelStyle}>Ends<input style={inputStyle} type="datetime-local" value={campaignForm.endsAt} onChange={(e) => setCampaignForm({ ...campaignForm, endsAt: e.target.value })} /></label>
              <button type="submit" style={{ ...inputStyle, background: "#0F1923", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Create</button>
            </form>
            <Table
              headers={["Name", "Type", "Status", "Window", "Influencer"]}
              rows={campaigns.map((c) => [
                c.name,
                c.type,
                <StatusToggle key={c._id} status={c.status} onChange={(status) => mutate(() => updatePromotionCampaign(c._id, { status }))} />,
                c.startsAt || c.endsAt ? `${formatWhen(c.startsAt)} → ${formatWhen(c.endsAt)}` : "always",
                c.influencer?.name || "—",
              ])}
            />
          </section>
        )}

        {tab === "coupons" && (
          <section>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!couponForm.campaignId) {
                  setError("Pick a campaign before creating a coupon");
                  return;
                }
                await mutate(async () => {
                  await createPromotionCoupon(couponPayload(couponForm));
                  setCouponForm({ ...EMPTY_COUPON, campaignId: couponForm.campaignId });
                });
              }}
              style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: 16, marginBottom: 16 }}
            >
              <CouponFields form={couponForm} onChange={setCouponForm} campaigns={campaigns} />
              <button type="submit" style={{ ...inputStyle, width: "auto", marginTop: 12, background: "#0F1923", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Create coupon</button>
            </form>
            <Table
              headers={["Code", "Campaign", "Discount", "Valid", "Uses", "Rules", "Status", ""]}
              rows={coupons.flatMap((c) => {
                const row = [
                  c.codeDisplay || c.codeNormalized,
                  c.campaign?.name || "—",
                  c.discountType === "percent" ? `${c.discountValue}%` : `₹${c.discountValue}`,
                  c.startsAt || c.expiresAt ? `${formatWhen(c.startsAt)} → ${formatWhen(c.expiresAt)}` : "always",
                  <span key={`${c._id}-uses`} style={{ fontVariantNumeric: "tabular-nums" }}>
                    {c.redemptionCount || 0}{c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""}
                    {c.reservedCount > 0 && <span style={{ color: "#94A3B8" }}> (+{c.reservedCount} in checkout)</span>}
                  </span>,
                  describeRules(c),
                  <button
                    key={`${c._id}-status`}
                    type="button"
                    onClick={() => mutate(() => updatePromotionCoupon(c._id, { status: c.status === "active" ? "disabled" : "active" }))}
                    style={{ border: "none", background: "none", color: c.status === "active" ? "#0D9E6E" : "#B8860B", fontWeight: 700, cursor: "pointer" }}
                  >
                    {c.status}
                  </button>,
                  <button
                    key={`${c._id}-edit`}
                    type="button"
                    onClick={() => {
                      if (editingCouponId === c._id) { setEditingCouponId(null); setEditForm(null); return; }
                      setEditingCouponId(c._id);
                      setEditForm(couponToForm(c));
                    }}
                    style={{ border: "1px solid #E2E8F0", background: "#fff", borderRadius: 8, padding: "4px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                  >
                    {editingCouponId === c._id ? "Close" : "Edit"}
                  </button>,
                ];
                if (editingCouponId !== c._id || !editForm) return [row];
                const editor = (
                  <form
                    key={`${c._id}-editor`}
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const body = couponPayload(editForm, { forUpdate: true });
                      // A redeemed coupon cannot be renamed; don't send an unchanged code.
                      if (body.code === (c.codeDisplay || c.codeNormalized)) delete body.code;
                      await mutate(async () => {
                        await updatePromotionCoupon(c._id, body);
                        setEditingCouponId(null);
                        setEditForm(null);
                      });
                    }}
                    style={{ padding: "4px 0 8px" }}
                  >
                    <CouponFields form={editForm} onChange={setEditForm} campaigns={campaigns} lockCode={(c.redemptionCount || 0) > 0} />
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button type="submit" style={{ ...inputStyle, width: "auto", background: "#0F1923", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Save changes</button>
                      <button type="button" onClick={() => { setEditingCouponId(null); setEditForm(null); }} style={{ ...inputStyle, width: "auto", cursor: "pointer" }}>Cancel</button>
                    </div>
                  </form>
                );
                return [row, { span: true, cell: editor }];
              })}
            />
          </section>
        )}

        {tab === "influencers" && (
          <section>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const name = influencerForm.name.trim();
                if (!name) {
                  setError("Influencer name is required");
                  return;
                }
                try {
                  setError("");
                  await createPromotionInfluencer({
                    name,
                    slug: influencerForm.slug.trim() || undefined,
                  });
                  setInfluencerForm({ name: "", slug: "" });
                  await reload();
                } catch (err) {
                  setError(err.message || "Could not create influencer");
                }
              }}
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginBottom: 16 }}
            >
              <input style={inputStyle} placeholder="Name" value={influencerForm.name} onChange={(e) => setInfluencerForm({ ...influencerForm, name: e.target.value })} />
              <input style={inputStyle} placeholder="slug (for ?ref=)" value={influencerForm.slug} onChange={(e) => setInfluencerForm({ ...influencerForm, slug: e.target.value })} />
              <button type="submit" style={{ ...inputStyle, background: "#0F1923", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Create</button>
            </form>
            <Table
              headers={["Name", "Slug", "Status"]}
              rows={influencers.map((i) => [
                i.name,
                i.slug,
                <button
                  key={i._id}
                  type="button"
                  onClick={() => mutate(() => updatePromotionInfluencer(i._id, { status: i.status === "active" ? "inactive" : "active" }))}
                  style={{ border: "none", background: "none", color: i.status === "active" ? "#0D9E6E" : "#B8860B", fontWeight: 700, cursor: "pointer" }}
                >
                  {i.status}
                </button>,
              ])}
            />
          </section>
        )}

        {tab === "redemptions" && (
          <Table
            headers={["When", "User", "Code", "Plan", "Charged", "Discount"]}
            rows={redemptions.map((r) => [
              r.createdAt ? new Date(r.createdAt).toLocaleString() : "—",
              r.user?.email || "—",
              r.codeUsed || r.coupon?.codeDisplay,
              r.planType,
              `₹${r.chargedAmount}`,
              `₹${r.discountAmount}`,
            ])}
          />
        )}
      </div>
    </div>
  );
}

// Every rule the API enforces, so a campaign no longer needs an engineer with
// an API client to get an expiry or a usage cap.
function CouponFields({ form, onChange, campaigns, lockCode = false }) {
  const set = (patch) => onChange({ ...form, ...patch });
  const togglePlan = (plan) =>
    set({
      applicablePlanTypes: form.applicablePlanTypes.includes(plan)
        ? form.applicablePlanTypes.filter((p) => p !== plan)
        : [...form.applicablePlanTypes, plan],
    });
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
      <label style={labelStyle}>Code
        <input style={inputStyle} required placeholder="CODE" value={form.code} disabled={lockCode} title={lockCode ? "A redeemed coupon cannot be renamed" : undefined} onChange={(e) => set({ code: e.target.value })} />
      </label>
      <label style={labelStyle}>Campaign
        <select style={inputStyle} required value={form.campaignId} onChange={(e) => set({ campaignId: e.target.value })}>
          <option value="">Campaign…</option>
          {campaigns.map((c) => (
            <option key={c._id} value={c._id}>{c.name}</option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>Discount type
        <select style={inputStyle} value={form.discountType} onChange={(e) => set({ discountType: e.target.value })}>
          <option value="percent">percent</option>
          <option value="fixed">fixed ₹</option>
        </select>
      </label>
      <label style={labelStyle}>{form.discountType === "percent" ? "Percent off (1–99)" : "Rupees off (whole)"}
        <input style={inputStyle} type="number" required min="1" max={form.discountType === "percent" ? 99 : undefined} step={form.discountType === "percent" ? "0.01" : "1"} value={form.discountValue} onChange={(e) => set({ discountValue: e.target.value })} />
      </label>
      <label style={labelStyle}>Starts (blank = now)
        <input style={inputStyle} type="datetime-local" value={form.startsAt} onChange={(e) => set({ startsAt: e.target.value })} />
      </label>
      <label style={labelStyle}>Expires (blank = never)
        <input style={inputStyle} type="datetime-local" value={form.expiresAt} onChange={(e) => set({ expiresAt: e.target.value })} />
      </label>
      <label style={labelStyle}>Total uses (blank = unlimited)
        <input style={inputStyle} type="number" min="1" step="1" value={form.maxRedemptions} onChange={(e) => set({ maxRedemptions: e.target.value })} />
      </label>
      <label style={labelStyle}>Uses per user
        <input style={inputStyle} type="number" min="1" step="1" value={form.maxPerUser} onChange={(e) => set({ maxPerUser: e.target.value })} />
      </label>
      <label style={labelStyle}>Minimum plan price ₹
        <input style={inputStyle} type="number" min="0" step="1" placeholder="0" value={form.minAmount} onChange={(e) => set({ minAmount: e.target.value })} />
      </label>
      <div style={labelStyle}>Plans (none = all)
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontWeight: 500, fontSize: 12, color: "#0F1923" }}>
          {PLAN_TYPES.map((plan) => (
            <label key={plan} style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" checked={form.applicablePlanTypes.includes(plan)} onChange={() => togglePlan(plan)} />
              {plan.replace("_", " ")}
            </label>
          ))}
        </div>
      </div>
      <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", alignSelf: "end" }}>
        <input type="checkbox" checked={form.firstTimePayerOnly} onChange={(e) => set({ firstTimePayerOnly: e.target.checked })} />
        First-time payers only
      </label>
      <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", alignSelf: "end" }}>
        <input type="checkbox" checked={form.excludeActiveSubscribers} onChange={(e) => set({ excludeActiveSubscribers: e.target.checked })} />
        Not for active subscribers
      </label>
    </div>
  );
}

function StatusToggle({ status, onChange }) {
  return (
    <select value={status} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
      <option value="draft">draft</option>
      <option value="active">active</option>
      <option value="paused">paused</option>
      <option value="ended">ended</option>
    </select>
  );
}

function Table({ headers, rows }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#F8FAFC", textAlign: "left" }}>
            {headers.map((h) => (
              <th key={h} style={{ padding: "12px 14px", color: "#64748B", fontSize: 11, letterSpacing: "0.06em" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={headers.length} style={{ padding: 24, color: "#94A3B8" }}>Nothing here yet.</td></tr>
          ) : rows.map((row, i) => (
            // A row may be a full-width panel (the inline coupon editor).
            row?.span ? (
              <tr key={i} style={{ background: "#F8FAFC" }}>
                <td colSpan={headers.length} style={{ padding: "8px 14px 14px" }}>{row.cell}</td>
              </tr>
            ) : (
              <tr key={i} style={{ borderTop: "1px solid #F1F5F9" }}>
                {row.map((cell, j) => (
                  <td key={j} style={{ padding: "12px 14px" }}>{cell}</td>
                ))}
              </tr>
            )
          ))}
        </tbody>
      </table>
    </div>
  );
}
