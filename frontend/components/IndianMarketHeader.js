"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { useUserProfile } from "@/features/auth/hooks/useUserProfile";
import MobileUserDrawer from "@/features/shared/components/MobileUserDrawer";

function getInitials(name) {
  if (!name) return "T";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
import MarketSwitcher from "@/components/MarketSwitcher";
import { signOutFirebase } from "@/services/firebaseAuth";
import apiClient from "@/services/apiClient";
import { clearAuthToken } from "@/utils/auth";
import { onUserLoggedOut } from "@/services/pushNotifications";

const NAV_ITEMS = [
  { href: "/indian-market/dashboard", label: "Dashboard" },
  { href: "/indian-market/trades",    label: "Trades"    },
  { href: "/indian-market/add-trade",    label: "Log Trade"    },
  { href: "/indian-market/analytics", label: "Analytics" },
  { href: "/indian-market/setups",    label: "Setups"    },
  { href: "/profile",                 label: "Profile"   },
  { href: "/weekly-reports?market=Indian_Market", label: "Reports" },
  { href: "/indian-market/discipline",             label: "Discipline" },
];

const DRAWER_NAV_ITEMS = NAV_ITEMS.filter(n => n.href !== "/indian-market/add-trade");

export default function IndianMarketHeader() {
  const router   = useRouter();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { profile } = useUserProfile();

  const isActive = (href) => {
    const base = href.split("?")[0];
    return pathname === base || (base !== "/indian-market/dashboard" && pathname.startsWith(base));
  };

  const handleLogout = async () => {
    await onUserLoggedOut();
    try { await apiClient.post("/auth/logout"); } catch {}
    await clearAuthToken();
    await signOutFirebase();
    router.push("/login");
  };

  return (
    <>
      <header style={{
        position: "sticky", top: 0, zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px", height: 60,
        background: "rgba(240,238,233,0.97)",
        borderBottom: "1px solid var(--color-border-subtle)",
        boxShadow: "0 1px 0 rgba(15,25,35,0.06)",
      }}>

        {/* Logo */}
        <Link href="/indian-market/dashboard" style={{ textDecoration: "none", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <img src="/mainlogo1.png" alt="Edgecipline"
            style={{ width: 130, height: 36, objectFit: "contain", display: "block" }} />
          <span style={{ fontSize: 9, letterSpacing: "0.14em", color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, display: "block" }}>
            NSE / BSE
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="im-hdr-desktop" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <nav style={{ display: "flex", alignItems: "center", gap: 2, marginRight: 8 }}>
            {NAV_ITEMS.map(n => {
              const active = isActive(n.href);
              return (
                <Link key={n.href} href={n.href} className="im-hdr-link"
                  style={{
                    fontSize: 13, fontWeight: active ? 700 : 500,
                    color: active ? "var(--color-primary)" : "#4A5568",
                    textDecoration: "none",
                    padding: "6px 12px", borderRadius: 6,
                    fontFamily: "'Plus Jakarta Sans',sans-serif",
                    transition: "all 0.15s",
                    background: active ? "rgba(13,158,110,0.08)" : "transparent",
                  }}>
                  {n.label}
                </Link>
              );
            })}
          </nav>

          <div style={{ width: 1, height: 20, background: "#E2E8F0", margin: "0 8px" }} />

          <MarketSwitcher />

          <button onClick={handleLogout} title="Logout" style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 36, height: 36, marginLeft: 8,
            background: "transparent", border: "1px solid #E2E8F0",
            borderRadius: 8, cursor: "pointer",
            color: "#94A3B8", transition: "all 0.15s",
          }} className="im-hdr-logout">
            <LogOut size={15} />
          </button>
        </div>

        {/* Mobile avatar */}
        <button
          className="im-hdr-mobile"
          onClick={() => setDrawerOpen(true)}
          style={{ width: 38, height: 38, borderRadius: "50%", background: "linear-gradient(135deg,#0D9E6E,#22C78E)", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Plus Jakarta Sans',sans-serif", boxShadow: "0 4px 10px rgba(13,158,110,0.3)", flexShrink: 0 }}
        >
          {getInitials(profile?.name)}
        </button>
      </header>

      <MobileUserDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onLogout={handleLogout}
        profile={profile}
        navItems={DRAWER_NAV_ITEMS}
      />

      <style jsx>{`
        .im-hdr-link:hover {
          background: rgba(13,158,110,0.06) !important;
          color: var(--color-primary) !important;
        }
        .im-hdr-logout:hover {
          color: var(--color-error) !important;
          border-color: rgba(214,59,59,0.3) !important;
          background: rgba(214,59,59,0.05) !important;
        }
        @media (max-width: 768px) {
          .im-hdr-desktop { display: none !important; }
          .im-hdr-mobile  { display: flex !important; }
        }
        @media (min-width: 769px) {
          .im-hdr-mobile  { display: none !important; }
        }
      `}</style>
    </>
  );
}
