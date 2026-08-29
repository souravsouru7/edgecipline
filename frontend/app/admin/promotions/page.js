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
  getPromotionRedemptions,
} from "@/services/adminApi";

const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #E2E8F0",
  borderRadius: 8,
  fontSize: 13,
};

export default function AdminPromotionsPage() {
  const [overview, setOverview] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [influencers, setInfluencers] = useState([]);
  const [redemptions, setRedemptions] = useState([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");

  const [campaignForm, setCampaignForm] = useState({ name: "", type: "general", status: "active" });
  const [couponForm, setCouponForm] = useState({
    code: "",
    campaignId: "",
    discountType: "percent",
    discountValue: 20,
    firstTimePayerOnly: false,
  });
  const [influencerForm, setInfluencerForm] = useState({ name: "", slug: "" });

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
                  });
                  setCampaignForm({ name: "", type: "general", status: "active" });
                  await reload();
                } catch (err) {
                  setError(err.message || "Could not create campaign");
                }
              }}
              style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8, marginBottom: 16 }}
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
              <button type="submit" style={{ ...inputStyle, background: "#0F1923", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Create</button>
            </form>
            <Table
              headers={["Name", "Type", "Status", "Influencer"]}
              rows={campaigns.map((c) => [
                c.name,
                c.type,
                <StatusToggle key={c._id} status={c.status} onChange={(status) => updatePromotionCampaign(c._id, { status }).then(reload)} />,
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
                try {
                  setError("");
                  await createPromotionCoupon({
                    ...couponForm,
                    code: couponForm.code.trim(),
                    discountValue: Number(couponForm.discountValue),
                  });
                  setCouponForm({ ...couponForm, code: "" });
                  await reload();
                } catch (err) {
                  setError(err.message || "Could not create coupon");
                }
              }}
              style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1fr 80px auto", gap: 8, marginBottom: 16 }}
            >
              <input style={inputStyle} placeholder="CODE" value={couponForm.code} onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value })} />
              <select style={inputStyle} value={couponForm.campaignId} onChange={(e) => setCouponForm({ ...couponForm, campaignId: e.target.value })}>
                <option value="">Campaign…</option>
                {campaigns.map((c) => (
                  <option key={c._id} value={c._id}>{c.name}</option>
                ))}
              </select>
              <select style={inputStyle} value={couponForm.discountType} onChange={(e) => setCouponForm({ ...couponForm, discountType: e.target.value })}>
                <option value="percent">percent</option>
                <option value="fixed">fixed ₹</option>
              </select>
              <input style={inputStyle} type="number" min="1" value={couponForm.discountValue} onChange={(e) => setCouponForm({ ...couponForm, discountValue: e.target.value })} />
              <button type="submit" style={{ ...inputStyle, background: "#0F1923", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Create</button>
            </form>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, marginBottom: 12 }}>
              <input type="checkbox" checked={couponForm.firstTimePayerOnly} onChange={(e) => setCouponForm({ ...couponForm, firstTimePayerOnly: e.target.checked })} />
              First-time payer only
            </label>
            <Table
              headers={["Code", "Campaign", "Discount", "Uses", "Status"]}
              rows={coupons.map((c) => [
                c.codeDisplay || c.codeNormalized,
                c.campaign?.name || "—",
                c.discountType === "percent" ? `${c.discountValue}%` : `₹${c.discountValue}`,
                c.redemptionCount || 0,
                <button
                  key={c._id}
                  type="button"
                  onClick={() => updatePromotionCoupon(c._id, { status: c.status === "active" ? "disabled" : "active" }).then(reload)}
                  style={{ border: "none", background: "none", color: "#B8860B", fontWeight: 700, cursor: "pointer" }}
                >
                  {c.status}
                </button>,
              ])}
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
              rows={influencers.map((i) => [i.name, i.slug, i.status])}
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
            <tr key={i} style={{ borderTop: "1px solid #F1F5F9" }}>
              {row.map((cell, j) => (
                <td key={j} style={{ padding: "12px 14px" }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
