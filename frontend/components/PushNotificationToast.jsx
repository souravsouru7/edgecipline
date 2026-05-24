"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { getNotificationTarget } from "@/services/pushNotifications";

function getDisplayNotification(detail = {}) {
  return {
    title: detail.title || detail.notification?.title || "New notification",
    body: detail.body || detail.notification?.body || "",
    data: detail.data || {},
  };
}

export default function PushNotificationToast() {
  const [notification, setNotification] = useState(null);

  useEffect(() => {
    let closeTimer;

    const handlePush = (event) => {
      const nextNotification = getDisplayNotification(event.detail || {});
      setNotification(nextNotification);
      window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(() => setNotification(null), 8000);
    };

    window.addEventListener("edgecipline:push", handlePush);
    return () => {
      window.clearTimeout(closeTimer);
      window.removeEventListener("edgecipline:push", handlePush);
    };
  }, []);

  if (!notification) return null;

  const isMorningMentor = notification.data?.type === "morning_mentor";
  const target = getNotificationTarget(notification.data);

  const openNotification = () => {
    setNotification(null);
    window.dispatchEvent(
      new CustomEvent("edgecipline:notification-route", { detail: { target } })
    );
  };

  return (
    <div
      style={{
        position: "fixed",
        left: 16,
        right: 16,
        top: "calc(env(safe-area-inset-top, 0px) + 14px)",
        zIndex: 10000,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          border: `1px solid ${isMorningMentor ? "rgba(245,158,11,0.42)" : "rgba(56,189,248,0.32)"}`,
          background: isMorningMentor ? "#120D00" : "#071018",
          color: "#F8FAFC",
          borderRadius: 12,
          boxShadow: "0 18px 48px rgba(0,0,0,0.38)",
          overflow: "hidden",
          position: "relative",
          pointerEvents: "auto",
        }}
      >
        <button
          type="button"
          onClick={openNotification}
          style={{
            width: "100%",
            border: "none",
            background: "transparent",
            color: "inherit",
            padding: "12px 48px 12px 14px",
            display: "flex",
            gap: 11,
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              background: isMorningMentor ? "rgba(245,158,11,0.14)" : "rgba(56,189,248,0.12)",
              color: isMorningMentor ? "#F59E0B" : "#38BDF8",
            }}
          >
            <Bell size={17} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", color: isMorningMentor ? "#F59E0B" : "#38BDF8", marginBottom: 3 }}>
              TAP TO OPEN
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.35, marginBottom: notification.body ? 3 : 0 }}>
              {notification.title}
            </div>
            {notification.body && (
              <div style={{ fontSize: 12, lineHeight: 1.45, color: "#94A3B8" }}>
                {notification.body}
              </div>
            )}
          </div>
        </button>

        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={() => setNotification(null)}
          style={{
            position: "absolute",
            right: 10,
            top: 10,
            width: 28,
            height: 28,
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(0,0,0,0.2)",
            color: "#94A3B8",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            pointerEvents: "auto",
          }}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
