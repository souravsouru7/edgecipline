"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { 
  getAdminPayments, 
  updateAdminPaymentStatus, 
  addManualPayment,
  getAllAdminUsers 
} from "@/services/adminApi";
import AdminHeader from "@/components/AdminHeader";


/* ─────────────────────────────────────────
   PAYMENTS MANAGEMENT PAGE – Light theme
───────────────────────────────────────── */
// Keep in step with PLAN_CONFIG in backend/services/paymentService.js. The
// amount is pre-filled from here but any amount is accepted — an off-price
// entry is flagged as discounted on the record. Custom needs a day count.
const MANUAL_PLANS = {
  monthly: { label: "1 Month", amount: 349 },
  "3_months": { label: "3 Months", amount: 899 },
  "6_months": { label: "6 Months", amount: 1499 },
  custom: { label: "Custom Extension", amount: null },
};

const EMPTY_MANUAL_FORM = {
  userId: "",
  amount: MANUAL_PLANS["3_months"].amount,
  transactionId: "",
  planType: "3_months",
  customDays: "",
  notes: "",
};

export default function PaymentsPage() {
  const router = useRouter();
  const [payments, setPayments] = useState([]);
  const [users, setUsers] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [mounted, setMounted] = useState(false);

  const [showManualModal, setShowManualModal] = useState(false);
  
  // Manual Payment Form State
  const [manualForm, setManualForm] = useState(EMPTY_MANUAL_FORM);

  useEffect(() => {
    setMounted(true);
    fetchData();
  }, []);


  const fetchData = async () => {
    try {
      setLoading(true);
      const [paymentsData, usersData] = await Promise.all([
        getAdminPayments(),
        getAllAdminUsers()
      ]);
      const fetchedPayments = Array.isArray(paymentsData) ? paymentsData : paymentsData?.payments;
      const fetchedUsers = Array.isArray(usersData) ? usersData : usersData?.users;
      if (Array.isArray(fetchedPayments)) setPayments(fetchedPayments);
      if (Array.isArray(fetchedUsers)) setUsers(fetchedUsers);
    } catch (err) {
      setError(err.message || "An error occurred fetching data");
    } finally {
      setLoading(false);
    }
  };

  const handleStatusUpdate = async (id, status) => {
    try {
      await updateAdminPaymentStatus(id, status);
      setSuccess(`Payment status set to ${status}`);
      fetchData();
    } catch (err) {
      setError(err.message || "Update failed");
    }
  };

  const handlePlanTypeChange = (planType) => {
    const plan = MANUAL_PLANS[planType];
    setManualForm((prev) => ({
      ...prev,
      planType,
      // Fixed plans are recorded at their configured price; only Custom
      // keeps whatever the admin typed.
      amount: plan?.amount ?? prev.amount,
      customDays: planType === "custom" ? prev.customDays : "",
    }));
  };

  const validateManualForm = () => {
    if (!manualForm.userId) return "Please select a user";
    const amountString = String(manualForm.amount ?? "").trim();
    if (!/^\d+(\.\d{1,2})?$/.test(amountString) || Number(amountString) <= 0) {
      return "Amount must be a positive number with at most two decimals";
    }
    const plan = MANUAL_PLANS[manualForm.planType];
    if (!plan) return "Please choose a plan type";
    if (manualForm.planType === "custom") {
      const days = Number(manualForm.customDays);
      if (!Number.isInteger(days) || days <= 0) return "Enter the number of days (1 or more) for a custom extension";
      if (days > 3650) return "Custom extension cannot exceed 3650 days";
    }
    return null;
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    const validationError = validateManualForm();
    if (validationError) return setError(validationError);

    const payload = {
      userId: manualForm.userId,
      amount: Number(manualForm.amount),
      planType: manualForm.planType,
      transactionId: manualForm.transactionId.trim() || undefined,
      notes: manualForm.notes.trim() || undefined,
    };
    if (manualForm.planType === "custom") {
      payload.customDays = Number(manualForm.customDays);
    }

    try {
      await addManualPayment(payload);
      setSuccess("Manual payment recorded and plan extended");
      setShowManualModal(false);
      setManualForm(EMPTY_MANUAL_FORM);
      fetchData();
    } catch (err) {
      setError(err.message || "Manual record failed");
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "completed": return "#0D9E6E";
      case "pending": return "#B8860B";
      case "refunded": return "#D63B3B";
      case "failed": return "#D63B3B";
      default: return "#94A3B8";
    }
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#F0EEE9",
      fontFamily: "'Plus Jakarta Sans',sans-serif",
      color: "#0F1923",
    }}>

      <AdminHeader title="PAYMENT TRACKING" subtitle="ADMIN PORTAL" />

      <div style={{ padding: "0 28px", marginTop: 12 }}>
        <button 
          onClick={() => setShowManualModal(true)}
          style={{
            background: "#B8860B", border: "none", borderRadius: 8, padding: "8px 16px",
            color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer",
            boxShadow: "0 4px 12px rgba(184,134,11,0.2)"
          }}
        >
          + ADD MANUAL PAYMENT
        </button>
      </div>

      {/* Accent bar */}
      <div style={{ height: 3, background: "linear-gradient(90deg,#B8860B 0%,#0D9E6E 50%,#B8860B 100%)" }} />

      <main style={{ padding: "32px 28px", maxWidth: 1400, margin: "0 auto" }}>
        
        {/* Alerts */}
        {error && (
          <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", color: "#B91C1C", padding: "12px 16px", borderRadius: 8, marginBottom: 20, fontSize: 13, display: "flex", justifyContent: "space-between" }}>
            {error} <button onClick={() => setError("")} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit" }}>×</button>
          </div>
        )}
        {success && (
          <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", color: "#15803D", padding: "12px 16px", borderRadius: 8, marginBottom: 20, fontSize: 13, display: "flex", justifyContent: "space-between" }}>
            {success} <button onClick={() => setSuccess("")} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit" }}>×</button>
          </div>
        )}

        {/* Payments Table */}
        <div style={{
          background: "white", borderRadius: 16, border: "1px solid #E2E8F0",
          boxShadow: "0 1px 6px rgba(0,0,0,0.05)", overflow: "hidden"
        }}>
          <div style={{ padding: "24px", borderBottom: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0F1923", margin: 0 }}>Transaction History</h2>
            <div style={{ color: "#94A3B8", fontSize: 12, fontFamily: "'JetBrains Mono',monospace" }}>{payments.length} RECORDS</div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #F1F5F9", background: "#F8FAFC" }}>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }}>USER</th>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }}>AMOUNT</th>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }}>PLAN / EXPIRY</th>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }}>METHOD / ID</th>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }}>STATUS</th>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em", textAlign: "right" }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="6" style={{ padding: "40px", textAlign: "center", color: "#94A3B8", fontSize: 13 }}>Loading payments...</td>
                  </tr>
                ) : payments.length === 0 ? (
                  <tr>
                    <td colSpan="6" style={{ padding: "40px", textAlign: "center", color: "#94A3B8", fontSize: 13 }}>No payment records found.</td>
                  </tr>
                ) : (
                  payments.map((payment) => (
                    <tr key={payment._id} style={{ borderBottom: "1px solid #F1F5F9", fontSize: 13, transition: "background 0.2s" }} onMouseEnter={e => e.currentTarget.style.background = "#FBFBFA"} onMouseLeave={e => e.currentTarget.style.background = "none"}>
                      <td style={{ padding: "16px 24px" }}>
                        <div style={{ fontWeight: 700, color: "#0F1923" }}>{payment.user?.name || "Deleted User"}</div>
                        <div style={{ fontSize: 11, color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace" }}>{payment.user?.email || "N/A"}</div>
                      </td>
                      <td style={{ padding: "16px 24px" }}>
                        <div style={{ fontWeight: 800, color: "#0F1923" }}>₹{payment.amount}</div>
                        <div style={{ fontSize: 10, color: "#94A3B8" }}>{new Date(payment.createdAt).toLocaleDateString()}</div>
                      </td>
                      <td style={{ padding: "16px 24px" }}>
                        <div style={{ fontWeight: 600, color: "#4A5568" }}>{MANUAL_PLANS[payment.planType]?.label || payment.planType || "—"}</div>
                        <div style={{ fontSize: 10, color: "#0D9E6E" }}>
                          {payment.expiryDate ? `Exp: ${new Date(payment.expiryDate).toLocaleDateString()}` : "Not Activated"}
                        </div>
                      </td>
                      <td style={{ padding: "16px 24px" }}>
                        <div style={{
                          display: "inline-block", padding: "2px 8px", borderRadius: 4,
                          background: "#F1F5F9", fontSize: 10, fontWeight: 700, color: "#475569", marginBottom: 4
                        }}>
                          {payment.paymentMethod?.toUpperCase()}
                        </div>
                        <div style={{ fontSize: 10, color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace" }}>{payment.transactionId}</div>
                      </td>
                      <td style={{ padding: "16px 24px" }}>
                        <div style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          padding: "4px 12px", borderRadius: 20, 
                          background: `${getStatusColor(payment.status)}12`,
                          color: getStatusColor(payment.status),
                          fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em"
                        }}>
                          {payment.status}
                        </div>
                      </td>
                      <td style={{ padding: "16px 24px", textAlign: "right" }}>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                          {payment.status === "pending" && (
                            <button 
                              onClick={() => handleStatusUpdate(payment._id, "completed")}
                              style={{ padding: "6px 12px", background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 6, cursor: "pointer", color: "#15803D", fontSize: 10, fontWeight: 700 }}
                            >
                              CONFIRM
                            </button>
                          )}
                          {payment.status === "completed" && (
                            <button 
                              onClick={() => handleStatusUpdate(payment._id, "refunded")}
                              style={{ padding: "6px 12px", background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 6, cursor: "pointer", color: "#B91C1C", fontSize: 10, fontWeight: 700 }}
                            >
                              REFUND
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Manual Payment Modal */}
        {showManualModal && (
          <div style={{
            position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
            background: "rgba(15,25,35,0.4)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
          }}>
            <div style={{ background: "white", borderRadius: 20, width: "100%", maxWidth: 450, padding: 32, boxShadow: "0 20px 50px rgba(0,0,0,0.15)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
                <h3 style={{ fontSize: 20, fontWeight: 800 }}>Record Manual Payment</h3>
                <button onClick={() => setShowManualModal(false)} style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#94A3B8" }}>×</button>
              </div>

              <form onSubmit={handleManualSubmit}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 6 }}>SELECT USER</label>
                  <select 
                    required
                    style={{ width: "100%", padding: "12px", borderRadius: 10, border: "1px solid #E2E8F0", outline: "none", fontSize: 14 }}
                    value={manualForm.userId}
                    onChange={e => setManualForm({...manualForm, userId: e.target.value})}
                  >
                    <option value="">Choose User...</option>
                    {users.map(u => <option key={u._id} value={u._id}>{u.name} ({u.email})</option>)}
                  </select>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 6 }}>AMOUNT (INR)</label>
                    <input 
                      type="number" required min="1" step="0.01"
                      style={{ width: "100%", padding: "12px", borderRadius: 10, border: "1px solid #E2E8F0", outline: "none", fontSize: 14 }}
                      value={manualForm.amount}
                      onChange={e => setManualForm({...manualForm, amount: e.target.value})}
                    />
                    {manualForm.planType !== "custom" && MANUAL_PLANS[manualForm.planType] && (
                      Number(manualForm.amount) === MANUAL_PLANS[manualForm.planType].amount ? (
                        <div style={{ fontSize: 11, color: "#64748B", marginTop: 6 }}>
                          Plan price: ₹{MANUAL_PLANS[manualForm.planType].amount}
                        </div>
                      ) : (
                        <div style={{ fontSize: 11, color: "#B8860B", marginTop: 6, fontWeight: 600 }}>
                          Differs from the {MANUAL_PLANS[manualForm.planType].label} price (₹{MANUAL_PLANS[manualForm.planType].amount}). It will be recorded as a discounted entry.
                        </div>
                      )
                    )}
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 6 }}>PLAN TYPE</label>
                    <select 
                      style={{ width: "100%", padding: "12px", borderRadius: 10, border: "1px solid #E2E8F0", outline: "none", fontSize: 14 }}
                      value={manualForm.planType}
                      onChange={e => handlePlanTypeChange(e.target.value)}
                    >
                      {Object.entries(MANUAL_PLANS).map(([key, plan]) => (
                        <option key={key} value={key}>
                          {plan.label}{plan.amount ? ` (₹${plan.amount})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {manualForm.planType === "custom" && (
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 6 }}>EXTEND BY (DAYS)</label>
                    <input 
                      type="number" required min="1" max="3650" step="1"
                      placeholder="e.g. 45"
                      style={{ width: "100%", padding: "12px", borderRadius: 10, border: "1px solid #E2E8F0", outline: "none", fontSize: 14 }}
                      value={manualForm.customDays}
                      onChange={e => setManualForm({...manualForm, customDays: e.target.value})}
                    />
                  </div>
                )}

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 6 }}>TRANSACTION ID (OPTIONAL)</label>
                  <input 
                    placeholder="e.g. BANK-TRF-123"
                    style={{ width: "100%", padding: "12px", borderRadius: 10, border: "1px solid #E2E8F0", outline: "none", fontSize: 14 }}
                    value={manualForm.transactionId}
                    onChange={e => setManualForm({...manualForm, transactionId: e.target.value})}
                  />
                </div>

                <button 
                  type="submit"
                  style={{
                    width: "100%", background: "#B8860B", color: "white", padding: "14px",
                    borderRadius: 12, border: "none", fontSize: 14, fontWeight: 700, cursor: "pointer",
                    boxShadow: "0 6px 20px rgba(184,134,11,0.25)", marginTop: 8
                  }}
                >
                  SAVE RECORD & EXTEND PLAN
                </button>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
