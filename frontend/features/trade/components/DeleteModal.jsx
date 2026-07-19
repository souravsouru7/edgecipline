"use client";

/**
 * DeleteModal
 * Confirmation overlay before permanently removing a trade.
 *
 * @param {Object}   trade     - The trade pending deletion
 * @param {Function} onConfirm - Called when user clicks DELETE TRADE
 * @param {Function} onCancel  - Called when user clicks CANCEL or backdrop
 */
export default function DeleteModal({ trade, onConfirm, onCancel }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      {/* Backdrop */}
      <div style={{ position: "absolute", inset: 0, background: "rgba(15,25,35,0.6)", backdropFilter: "blur(6px)" }} onClick={onCancel} />

      {/* Dialog */}
      <div style={{ position: "relative", background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 12, padding: "28px", maxWidth: 340, width: "100%", boxShadow: "0 8px 32px rgba(15,25,35,0.15)" }}>
        <div style={{ height: 3, background: "linear-gradient(90deg,#D63B3B,transparent)", marginBottom: 20, borderRadius: 2 }} />

        <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 18, fontWeight: 800, color: "#0F1923", marginBottom: 8 }}>
          DELETE TRADE?
        </div>
        <div style={{ fontSize: 10, color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace", marginBottom: 6, letterSpacing: "0.08em" }}>
          TRADE TO DELETE
        </div>
        <div style={{ fontSize: 13, color: "#0F1923", fontFamily: "'JetBrains Mono',monospace", marginBottom: 20, fontWeight: 600 }}>
          {trade?.pair} — {trade?.type?.toUpperCase()}
        </div>
        <div style={{ fontSize: 9, color: "#94A3B8", letterSpacing: "0.06em", marginBottom: 22, lineHeight: 1.6 }}>
          THIS ACTION CANNOT BE UNDONE. THE TRADE WILL BE PERMANENTLY REMOVED FROM YOUR TRADE LOG.
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onCancel}
            style={{ flex: 1, padding: "10px", background: "#F8F6F2", border: "1px solid #E2E8F0", borderRadius: 6, color: "#4A5568", fontSize: 10, fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.12em", cursor: "pointer" }}
          >CANCEL</button>
          <button
            onClick={onConfirm}
            style={{ flex: 1, padding: "10px", background: "linear-gradient(135deg,#D63B3B,#F87171)", border: "none", borderRadius: 6, color: "#FFFFFF", fontSize: 10, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, letterSpacing: "0.12em", cursor: "pointer", boxShadow: "0 4px 12px rgba(214,59,59,0.3)" }}
          >DELETE TRADE</button>
        </div>
      </div>
    </div>
  );
}
