"use client";

import { useState, useEffect } from "react";

export default function InstallPWA() {
    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [isInstalled, setIsInstalled] = useState(() => (
        typeof window !== "undefined"
        && (
            window.matchMedia("(display-mode: standalone)").matches
            || window.navigator.standalone === true
        )
    ));

    useEffect(() => {
        const handleBeforeInstallPrompt = (e) => {
            e.preventDefault();
            setDeferredPrompt(e);
        };

        const handleAppInstalled = () => {
            setIsInstalled(true);
            setDeferredPrompt(null);
        };

        window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
        window.addEventListener("appinstalled", handleAppInstalled);

        return () => {
            window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
            window.removeEventListener("appinstalled", handleAppInstalled);
        };
    }, []);

    const handleInstallClick = async () => {
        if (!deferredPrompt) return;

        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;

        if (outcome === "accepted") {
            console.log("User accepted the install prompt");
        } else {
            console.log("User dismissed the install prompt");
        }
        setDeferredPrompt(null);
    };

    if (isInstalled || !deferredPrompt) {
        return null;
    }

    return (
        <button
            onClick={handleInstallClick}
            style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "rgba(34,199,142,0.1)", border: "1px solid rgba(34,199,142,0.3)",
                borderRadius: 6, padding: "6px 12px",
                cursor: "pointer", fontSize: 10, letterSpacing: "0.1em",
                color: "#0D9E6E", fontFamily: "'JetBrains Mono',monospace", fontWeight: 700,
                transition: "all 0.2s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(13,158,110,0.15)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(34,199,142,0.1)"; }}
        >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            INSTALL APP
        </button>
    );
}
