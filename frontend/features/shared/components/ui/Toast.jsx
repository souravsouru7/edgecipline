"use client";

import React, { useState, createContext, useContext, useCallback, useMemo, memo } from "react";
import * as haptics from "@/utils/haptics";
import { X, CheckCircle, AlertCircle, Info, Loader2 } from "lucide-react";

const ToastContext = createContext();

/**
 * ToastProvider
 * Wraps the app and provides a way to trigger notifications.
 */
export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  // M24: Track timer IDs so they can be cleared on removeToast/unmount
  const timersRef = React.useRef({});
  const nextToastIdRef = React.useRef(0);

  const removeToast = useCallback((id) => {
    clearTimeout(timersRef.current[id]);
    delete timersRef.current[id];
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message, type = "info", duration = 5000) => {
    if (type === "error") void haptics.warning();
    const id = `${Date.now()}-${nextToastIdRef.current++}`;
    let timerId = id;
    setToasts((prev) => {
      const duplicate = prev.find((t) => t.message === message && t.type === type);
      if (duplicate) {
        timerId = duplicate.id;
        clearTimeout(timersRef.current[duplicate.id]);
        delete timersRef.current[duplicate.id];
        return prev.map((t) => t.id === duplicate.id ? { ...t, duration } : t);
      }
      return [...prev, { id, message, type, duration }];
    });
    if (duration !== Infinity) {
      timersRef.current[timerId] = setTimeout(() => removeToast(timerId), duration);
    }
    return timerId;
  }, [removeToast]);

  React.useEffect(() => {
    const timers = timersRef.current;
    return () => { Object.values(timers).forEach(clearTimeout); };
  }, []);

  const contextValue = useMemo(() => ({ addToast, removeToast }), [addToast, removeToast]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div className="toast-container">
        {toasts.map((t) => (
          <ToastItem key={t.id} {...t} onRemove={removeToast} />
        ))}
      </div>
      <style jsx>{`
        .toast-container {
          position: fixed;
          /* Clear the gesture bar and, on phones, the 64px bottom nav. */
          bottom: calc(24px + env(safe-area-inset-bottom, 0px));
          right: calc(24px + env(safe-area-inset-right, 0px));
          display: flex;
          flex-direction: column;
          gap: 12px;
          z-index: 9999;
          max-width: 400px;
          width: calc(100% - 48px);
        }
        @media (max-width: 640px) {
          .toast-container {
            bottom: calc(80px + env(safe-area-inset-bottom, 0px));
            right: calc(16px + env(safe-area-inset-right, 0px));
            width: calc(100% - 32px);
          }
        }
      `}</style>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
};

const ToastItem = memo(({ id, message, type, onRemove }) => {
  const handleRemove = useCallback(() => onRemove(id), [id, onRemove]);

  const icons = {
    success: <CheckCircle size={18} color="#0D9E6E" />,
    error: <AlertCircle size={18} color="#D63B3B" />,
    info: <Info size={18} color="#3182CE" />,
    loading: <Loader2 size={18} color="#718096" className="animate-spin" />,
  };

  // Theme tokens, so toasts read correctly in dark mode (they were fixed light
  // boxes): a surface tinted with the message's colour.
  const tone = {
    success: "var(--ec-profit, #0D9E6E)",
    error: "var(--ec-loss, #D63B3B)",
    info: "var(--ec-info, #3182CE)",
    loading: "var(--ec-text-3, #718096)",
  };
  const bgColors = Object.fromEntries(
    Object.entries(tone).map(([k, c]) => [k, `color-mix(in srgb, ${c} 10%, var(--ec-surface, #FFFFFF))`])
  );
  const borderColors = Object.fromEntries(
    Object.entries(tone).map(([k, c]) => [k, `color-mix(in srgb, ${c} 35%, transparent)`])
  );

  return (
    <div 
      className="toast-item visible"
      style={{
        background: bgColors[type],
        border: `1px solid ${borderColors[type]}`,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderRadius: 12,
        boxShadow: "0 10px 24px -6px rgba(0, 0, 0, 0.25)",
        transform: "translateX(0)",
        opacity: 1,
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      <div style={{ flexShrink: 0 }}>{icons[type]}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ec-text, #2D3748)", flex: 1, lineHeight: 1.45 }}>{message}</div>
      <button 
        type="button"
        aria-label="Dismiss"
        onClick={handleRemove}
        style={{ 
          background: "none", border: "none", padding: 4, cursor: "pointer", 
          color: "var(--ec-text-3, #A0AEC0)", borderRadius: 4, display: "flex" 
        }}
        onMouseEnter={e => e.currentTarget.style.background = "var(--ec-surface-2, rgba(0,0,0,0.05))"}
        onMouseLeave={e => e.currentTarget.style.background = "none"}
      >
        <X size={14} />
      </button>

      <style jsx>{`
        .animate-spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
});

ToastItem.displayName = "ToastItem";
