"use client";

import { useState, useEffect, useMemo } from "react";
import LoadingSpinner from "@/components/LoadingSpinner";

function formatValue(value, fallback = "Not available") {
  if (value == null || value === "") return fallback;
  return value;
}

function ResultRow({ label, value, positive = false, negative = false }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: "1px solid #EEF2F7" }}>
      <span style={{ fontSize: 12, color: "#64748B", fontWeight: 600 }}>{label}</span>
      <span
        style={{
          fontSize: 12,
          color: positive ? "#0D9E6E" : negative ? "#D63B3B" : "#0F172A",
          fontWeight: 700,
          textAlign: "right",
          wordBreak: "break-word",
        }}
      >
        {formatValue(value)}
      </span>
    </div>
  );
}

export default function TradeStatus({ status, data, error, onRetry, onReset }) {
  const parsedTrade = data?.parsedData?.parsedTrade || data?.parsedTrade || data || null;
  const parsedTrades = data?.parsedData?.parsedTrades || data?.parsedTrades || [];
  const pnlValue = parsedTrade?.profit ?? parsedTrade?.pnl ?? null;

  // Dynamic message rotation for processing state
  const [messageIndex, setMessageIndex] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);

  const processingMessages = useMemo(() => [
    { text: "Analyzing your trade...", step: 0 },
    { text: "Extracting trade data...", step: 1 },
    { text: "Running OCR recognition...", step: 1 },
    { text: "Processing with AI...", step: 2 },
    { text: "Generating insights...", step: 2 },
    { text: "Finalizing results...", step: 3 },
  ], []);

  // Error message mapping based on error type
  const getErrorDetails = () => {
    if (!error) {
      return {
        title: "Couldn't extract your trade properly",
        message: "Try uploading a clearer screenshot with better lighting and full trade details visible.",
        icon: "⚠️",
        color: "#DC2626",
        bg: "#FEF2F2",
        border: "#FECACA",
      };
    }

    const errorLower = error.toLowerCase();
    
    // OCR-specific errors
    if (errorLower.includes("ocr") || errorLower.includes("image") || errorLower.includes("vision")) {
      return {
        title: "Couldn't read the trade screenshot",
        message: "The image might be unclear, blurry, or missing key trade details. Try uploading a clearer screenshot.",
        icon: "📷",
        color: "#DC2626",
        bg: "#FEF2F2",
        border: "#FECACA",
      };
    }
    
    // AI-specific errors
    if (errorLower.includes("ai") || errorLower.includes("gemini") || errorLower.includes("extraction")) {
      return {
        title: "AI couldn't parse the trade data",
        message: "Our AI had trouble extracting the details. Please try again with a different screenshot or enter manually.",
        icon: "🤖",
        color: "#DC2626",
        bg: "#FEF2F2",
        border: "#FECACA",
      };
    }
    
    // Network errors
    if (errorLower.includes("network") || errorLower.includes("timeout") || errorLower.includes("connection")) {
      return {
        title: "Connection issue occurred",
        message: "Please check your internet connection and try again. Your trade data is safe.",
        icon: "🌐",
        color: "#DC2626",
        bg: "#FEF2F2",
        border: "#FECACA",
      };
    }
    
    // Generic error
    return {
      title: "Couldn't extract your trade properly",
      message: "Try uploading a clearer screenshot.",
      icon: "⚠️",
      color: "#DC2626",
      bg: "#FEF2F2",
      border: "#FECACA",
    };
  };

  useEffect(() => {
    if (status === "processing") {
      const interval = setInterval(() => {
        setMessageIndex((prev) => {
          const next = (prev + 1) % processingMessages.length;
          setCurrentStep(processingMessages[next].step);
          return next;
        });
      }, 2500); // Rotate messages every 2.5 seconds

      return () => clearInterval(interval);
    }
  }, [status, processingMessages]);

  if (!status) return null;

  if (status === "pending") {
    return (
      <div style={cardStyle}>
        <style>{globalStyles}</style>
        <LoadingSpinner message="UPLOAD RECEIVED..." />
        <p style={messageStyle}>Upload received. We&apos;re placing your trade into the processing queue.</p>
      </div>
    );
  }

  if (status === "processing") {
    return (
      <div style={cardStyle}>
        <style>{globalStyles}</style>
        <LoadingSpinner 
          message={processingMessages[messageIndex].text} 
          showProgress={true}
          currentStep={currentStep}
          totalSteps={4}
        />
        <p style={messageStyle}>OCR and AI extraction are running in the background. This can take a few moments.</p>
      </div>
    );
  }

  if (status === "failed") {
    const errorDetails = getErrorDetails();
    
    return (
      <div style={{ 
        ...cardStyle, 
        borderColor: errorDetails.border, 
        background: errorDetails.bg,
        animation: "shake 0.4s ease",
      }}>
        <style>{globalStyles}</style>
        {/* Warning Icon */}
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <span style={{ fontSize: 48, display: "block", marginBottom: 8 }}>{errorDetails.icon}</span>
        </div>
        
        {/* Error Title */}
        <div style={{ 
          fontSize: 18, 
          fontWeight: 800, 
          color: errorDetails.color, 
          marginBottom: 10,
          textAlign: "center",
          fontFamily: "'Plus Jakarta Sans',sans-serif",
        }}>
          {errorDetails.title}
        </div>
        
        {/* Error Message */}
        <p style={{ 
          ...messageStyle, 
          color: "#991B1B",
          fontSize: 13,
          lineHeight: 1.6,
          marginBottom: 20,
        }}>
          {error || errorDetails.message}
        </p>
        
        {/* Helpful Tips */}
        <div style={{ 
          background: "rgba(255,255,255,0.7)",
          border: `1px solid ${errorDetails.border}`,
          borderRadius: 12,
          padding: "14px 18px",
          marginBottom: 20,
        }}>
          <div style={{ fontSize: "var(--fs-2xs)", fontWeight: 700, color: "#991B1B", marginBottom: 8, letterSpacing: "0.05em" }}>
            💡 TIPS FOR BETTER EXTRACTION:
          </div>
          <ul style={{ 
            margin: 0, 
            paddingLeft: 16, 
            fontSize: 11, 
            color: "#7F1D1D",
            lineHeight: 1.8,
          }}>
            <li>Ensure the entire trade is visible in the screenshot</li>
            <li>Use good lighting and avoid glare</li>
            <li>Make sure text is clear and not blurry</li>
            <li>Include all trade details (entry, exit, P&L)</li>
          </ul>
        </div>
        
        {/* Action Buttons */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
          <button 
            onClick={onRetry} 
            style={{
              flex: 1,
              minWidth: 140,
              border: "none",
              borderRadius: 12,
              padding: "12px 18px",
              background: "linear-gradient(135deg, #0D9E6E, #22C78E)",
              color: "#FFFFFF",
              fontWeight: 800,
              fontSize: 12,
              letterSpacing: "0.08em",
              cursor: "pointer",
              boxShadow: "0 4px 12px rgba(13,158,110,0.3)",
              transition: "transform 0.2s, box-shadow 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = "0 6px 16px rgba(13,158,110,0.4)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 4px 12px rgba(13,158,110,0.3)";
            }}
          >
            🔄 TRY AGAIN
          </button>
          <button 
            onClick={onReset} 
            style={secondaryButtonStyle}
          >
            UPLOAD DIFFERENT TRADE
          </button>
        </div>
      </div>
    );
  }

  if (status === "completed") {
    return (
      <div style={{ ...cardStyle, animation: "fadeIn 0.35s ease" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#0F172A" }}>Trade processed</div>
            <div style={{ fontSize: 12, color: "#64748B" }}>Your extracted trade data is ready.</div>
          </div>
          {data?.needsReview && (
            <div style={{ fontSize: 11, fontWeight: 700, color: "#B45309", background: "#FFF7ED", border: "1px solid #FED7AA", padding: "6px 10px", borderRadius: 999 }}>
              Needs review
            </div>
          )}
        </div>

        <div style={{ border: "1px solid #E5E7EB", borderRadius: 14, padding: 16, background: "#FFFFFF" }}>
          <ResultRow label="Symbol" value={parsedTrade?.pair || parsedTrade?.symbol} />
          <ResultRow label="Action" value={parsedTrade?.type || parsedTrade?.action} />
          <ResultRow label="Quantity" value={parsedTrade?.quantity ?? parsedTrade?.lotSize} />
          <ResultRow label="Entry Price" value={parsedTrade?.entryPrice} />
          <ResultRow label="Exit Price" value={parsedTrade?.exitPrice} />
          <ResultRow
            label="PnL"
            value={pnlValue}
            positive={typeof pnlValue === "number" && pnlValue > 0}
            negative={typeof pnlValue === "number" && pnlValue < 0}
          />
          <ResultRow label="Status" value={data?.status || "completed"} />
          <ResultRow label="Strategy" value={data?.strategy} />
        </div>

        {Array.isArray(parsedTrades) && parsedTrades.length > 1 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#334155", marginBottom: 8 }}>Detected Trades</div>
            <div style={{ display: "grid", gap: 10 }}>
              {parsedTrades.map((trade, index) => (
                <div key={`${trade.symbol || trade.pair || "trade"}-${index}`} style={{ border: "1px solid #E2E8F0", borderRadius: 12, padding: 12, background: "#F8FAFC" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#0F172A" }}>{trade.symbol || trade.pair || `Trade ${index + 1}`}</div>
                  <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>
                    Qty: {formatValue(trade.quantity ?? trade.lotSize)} | Entry: {formatValue(trade.entryPrice)} | PnL: {formatValue(trade.pnl ?? trade.profit)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 18 }}>
          <button onClick={onReset} style={primaryButtonStyle}>Upload Another</button>
        </div>
      </div>
    );
  }

  return null;
}

const cardStyle = {
  background: "#FFFFFF",
  border: "1px solid #E2E8F0",
  borderRadius: 20,
  padding: 24,
  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
};

// Add shake animation for error states
const globalStyles = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
    20%, 40%, 60%, 80% { transform: translateX(4px); }
  }
`;

const messageStyle = {
  fontSize: 13,
  lineHeight: 1.6,
  color: "#475569",
  textAlign: "center",
  maxWidth: 520,
  margin: "0 auto",
};

const primaryButtonStyle = {
  border: "none",
  borderRadius: 12,
  padding: "12px 18px",
  background: "linear-gradient(135deg, #0D9E6E, #22C78E)",
  color: "#FFFFFF",
  fontWeight: 800,
  fontSize: 12,
  letterSpacing: "0.08em",
  cursor: "pointer",
};

const secondaryButtonStyle = {
  border: "1px solid #CBD5E1",
  borderRadius: 12,
  padding: "12px 18px",
  background: "#FFFFFF",
  color: "#334155",
  fontWeight: 800,
  fontSize: 12,
  letterSpacing: "0.08em",
  cursor: "pointer",
};
