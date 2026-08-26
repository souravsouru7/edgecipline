"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { submitFeedback } from "@/services/api";
import Link from "next/link";

/* ─────────────────────────────────────────
   SUPPORT & HELP PAGE – User Side
───────────────────────────────────────── */
export default function SupportPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [formData, setFormData] = useState({
    type: "GENERAL_FEEDBACK",
    subject: "",
    message: "",
    screenshot: null
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.subject || !formData.message) {
      setError("Please fill in all required fields.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      
      const data = new FormData();
      data.append("type", formData.type);
      data.append("subject", formData.subject);
      data.append("message", formData.message);
      if (formData.screenshot) {
        data.append("screenshot", formData.screenshot);
      }

      await submitFeedback(data);
      setSuccess(true);
      setFormData({ type: "GENERAL_FEEDBACK", subject: "", message: "", screenshot: null });
    } catch (err) {
      setError(err.message || "Failed to submit feedback. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setError("File size should be less than 5MB");
        return;
      }
      setFormData({ ...formData, screenshot: file });
    }
  };

  if (!mounted) return null;

  return (
    <div style={{
      minHeight: "100vh", background: "#F0EEE9",
      fontFamily: "'Plus Jakarta Sans',sans-serif",
      color: "#0F1923", position: "relative"
    }}>

      {/* ── HEADER ── */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", height: 60,
        background: "rgba(255,255,255,0.92)", backdropFilter: "blur(20px)",
        borderBottom: "1px solid #E2E8F0", position: "sticky", top: 0, zIndex: 100,
        boxShadow: "0 1px 12px rgba(15,25,35,0.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => router.back()} style={{ background: "none", border: "none", cursor: "pointer", color: "#0F1923", padding: 8, display: "flex", alignItems: "center" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.02em" }}>SUPPORT & HELP</div>
            <div style={{ fontSize: 8, color: "#0D9E6E", letterSpacing: "0.15em", fontFamily: "'JetBrains Mono'", fontWeight: 700 }}>24/7 ASSISTANCE</div>
          </div>
        </div>
        <Link href="/dashboard" style={{ textDecoration: "none", fontSize: 11, fontWeight: 700, color: "#B8860B", fontFamily: "'JetBrains Mono'" }}>
          BACK TO DASHBOARD
        </Link>
      </header>

      <div style={{ height: 3, background: "linear-gradient(90deg,#B8860B 0%,#0D9E6E 50%,#B8860B 100%)" }} />

      <main style={{ padding: "40px 24px", maxWidth: 900, margin: "0 auto" }}>
        
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 40, alignItems: "start" }}>
          
          {/* Left: Info */}
          <div>
            <h1 style={{ fontSize: 32, fontWeight: 800, color: "#0F1923", marginBottom: 16, lineHeight: 1.1 }}>
              How can we <span style={{ color: "#0D9E6E" }}>help you</span> today?
            </h1>
            <p style={{ fontSize: 14, color: "#4A5568", lineHeight: 1.6, marginBottom: 32 }}>
              {"Have a feature request, found a bug, or just want to say hi? We're all ears. Your feedback helps us make Edgecipline the best trading companion."}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {[
                { icon: "🐛", title: "Report a Bug", desc: "Found something broken? Let us fix it." },
                { icon: "💡", title: "Feature Request", desc: "Have an idea to improve the platform?" },
                { icon: "💬", title: "General Feedback", desc: "Tell us what you think or ask a question." }
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 16, alignItems: "start" }}>
                  <div style={{ fontSize: 24 }}>{item.icon}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#0F1923" }}>{item.title}</div>
                    <div style={{ fontSize: 12, color: "#94A3B8" }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 40, padding: 20, background: "white", borderRadius: 16, border: "1px solid #E2E8F0" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#B8860B", marginBottom: 8, letterSpacing: "0.05em" }}>RESPONSE TIME</div>
              <div style={{ fontSize: 13, color: "#4A5568" }}>We typically respond to all inquiries within 24-48 hours. Most bug reports are addressed even faster.</div>
            </div>
          </div>

          {/* Right: Form */}
          <div style={{ background: "white", borderRadius: 24, padding: 40, border: "1px solid #E2E8F0", boxShadow: "0 4px 24px rgba(0,0,0,0.04)" }}>
            {success ? (
              <div style={{ textAlign: "center", py: 40 }}>
                <div style={{ fontSize: 48, marginBottom: 20 }}>✅</div>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0F1923", marginBottom: 12 }}>Message Received!</h2>
                <p style={{ fontSize: 14, color: "#4A5568", lineHeight: 1.6, marginBottom: 32 }}>
                  Thank you for your feedback. Our team has been notified and will review your message shortly.
                </p>
                <button 
                  onClick={() => setSuccess(false)}
                  style={{ 
                    width: "100%", padding: "14px", background: "#0F1923", color: "white", 
                    border: "none", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer"
                  }}
                >
                  SEND ANOTHER MESSAGE
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: 24 }}>
                  <label style={{ fontSize: 11, fontWeight: 800, color: "#64748B", display: "block", marginBottom: 10, letterSpacing: "0.08em" }}>ISSUE TYPE</label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {[
                      { val: "BUG", label: "BUG" },
                      { val: "FEATURE_REQUEST", label: "FEATURE" },
                      { val: "GENERAL_FEEDBACK", label: "GENERAL" }
                    ].map(t => (
                      <button 
                        key={t.val} type="button"
                        onClick={() => setFormData({ ...formData, type: t.val })}
                        style={{
                          padding: "10px", borderRadius: 10, border: "1px solid",
                          borderColor: formData.type === t.val ? "#B8860B" : "#E2E8F0",
                          background: formData.type === t.val ? "#FFF7ED" : "white",
                          color: formData.type === t.val ? "#B8860B" : "#64748B",
                          fontSize: 10, fontWeight: 800, cursor: "pointer", transition: "all 0.2s"
                        }}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: 24 }}>
                  <label style={{ fontSize: 11, fontWeight: 800, color: "#64748B", display: "block", marginBottom: 10, letterSpacing: "0.08em" }}>SUBJECT</label>
                  <input 
                    type="text" 
                    value={formData.subject}
                    onChange={e => setFormData({ ...formData, subject: e.target.value })}
                    placeholder="Brief summary of your issue..."
                    style={{ width: "100%", padding: "12px 16px", borderRadius: 10, border: "1px solid #E2E8F0", outline: "none", fontSize: 14, fontFamily: "inherit" }}
                  />
                </div>

                <div style={{ marginBottom: 32 }}>
                  <label style={{ fontSize: 11, fontWeight: 800, color: "#64748B", display: "block", marginBottom: 10, letterSpacing: "0.08em" }}>DETAILED MESSAGE</label>
                  <textarea 
                    value={formData.message}
                    onChange={e => setFormData({ ...formData, message: e.target.value })}
                    placeholder="Describe your issue or request in detail..."
                    style={{ width: "100%", height: 160, padding: "12px 16px", borderRadius: 10, border: "1px solid #E2E8F0", outline: "none", fontSize: 14, fontFamily: "inherit", resize: "none" }}
                  />
                </div>
                <div style={{ marginBottom: 32 }}>
                  <label style={{ fontSize: 11, fontWeight: 800, color: "#64748B", display: "block", marginBottom: 10, letterSpacing: "0.08em" }}>ATTACH SCREENSHOT (OPTIONAL)</label>
                  <div style={{ 
                    border: "2px dashed #E2E8F0", borderRadius: 12, padding: "20px", 
                    textAlign: "center", position: "relative", cursor: "pointer",
                    background: formData.screenshot ? "#F0FDF4" : "transparent",
                    transition: "all 0.2s"
                  }}>
                    <input 
                      type="file" 
                      accept="image/*"
                      onChange={handleFileChange}
                      style={{ 
                        position: "absolute", inset: 0, width: "100%", height: "100%", 
                        opacity: 0, cursor: "pointer" 
                      }}
                    />
                    {formData.screenshot ? (
                      <div>
                        <div style={{ fontSize: 20, marginBottom: 8 }}>🖼️</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#0D9E6E" }}>{formData.screenshot.name}</div>
                        <div style={{ fontSize: 10, color: "#94A3B8" }}>Click or drag to change</div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontSize: 20, marginBottom: 8 }}>📁</div>
                        <div style={{ fontSize: 12, color: "#64748B", fontWeight: 600 }}>Click to upload screenshot</div>
                        <div style={{ fontSize: 10, color: "#94A3B8" }}>Supports PNG, JPG (Max 5MB)</div>
                      </div>
                    )}
                  </div>
                </div>
                {error && <div style={{ background: "#FEF2F2", color: "#B91C1C", padding: 12, borderRadius: 10, fontSize: 12, marginBottom: 24, fontWeight: 500 }}>{error}</div>}

                <button 
                  type="submit" 
                  disabled={loading}
                  style={{ 
                    width: "100%", padding: "16px", background: "linear-gradient(135deg, #0F1923 0%, #1a2d3d 100%)", 
                    color: "#22C78E", border: "1px solid rgba(34,199,142,0.3)", borderRadius: 12, 
                    fontSize: 13, fontWeight: 800, cursor: "pointer", letterSpacing: "0.08em",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)", transition: "all 0.2s"
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 6px 16px rgba(0,0,0,0.15)"; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)"; }}
                >
                  {loading ? "SUBMITTING..." : "SEND TO EDGEDISCIPLINE"}
                </button>
              </form>
            )}
          </div>
        </div>
      </main>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #F0EEE9; }
      `}</style>
    </div>
  );
}
