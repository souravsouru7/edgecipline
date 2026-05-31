"use client";

import React, { useState, createContext, useContext, useCallback } from "react";
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

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <div className="toast-container">
        {toasts.map((t) => (
          <ToastItem key={t.id} {...t} onRemove={() => removeToast(t.id)} />
        ))}
      </div>
      <style jsx>{`
        .toast-container {
          position: fixed;
          bottom: 24px;
          right: 24px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          z-index: 9999;
          max-width: 400px;
          width: calc(100% - 48px);
        }
        @media (max-width: 640px) {
          .toast-container {
            bottom: 16px;
            right: 16px;
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

const ToastItem = ({ message, type, onRemove }) => {
  const icons = {
    success: <CheckCircle size={18} color="#0D9E6E" />,
    error: <AlertCircle size={18} color="#D63B3B" />,
    info: <Info size={18} color="#3182CE" />,
    loading: <Loader2 size={18} color="#718096" className="animate-spin" />,
  };

  const bgColors = {
    success: "#F0FFF4",
    error: "#FFF5F5",
    info: "#EBF8FF",
    loading: "#F7FAFC",
  };

  const borderColors = {
    success: "rgba(13, 158, 110, 0.2)",
    error: "rgba(214, 59, 59, 0.2)",
    info: "rgba(49, 130, 206, 0.2)",
    loading: "rgba(113, 128, 150, 0.2)",
  };

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
        boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
        transform: "translateX(0)",
        opacity: 1,
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      <div style={{ flexShrink: 0 }}>{icons[type]}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#2D3748", flex: 1 }}>{message}</div>
      <button 
        onClick={onRemove}
        style={{ 
          background: "none", border: "none", padding: 4, cursor: "pointer", 
          color: "#A0AEC0", borderRadius: 4, display: "flex" 
        }}
        onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,0.05)"}
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
};
