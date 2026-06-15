"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import MarketSwitcher from "@/components/MarketSwitcher";
import { signOutFirebase } from "@/services/firebaseAuth";
import apiClient from "@/services/apiClient";
import { clearAuthToken } from "@/utils/auth";
import { useUserProfile } from "@/features/auth/hooks/useUserProfile";
import MobileUserDrawer from "./MobileUserDrawer";

function getInitials(name) {
  if (!name) return "T";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const NAV_LINKS = [
  { href: "/dashboard",                    label: "Dashboard" },
  { href: "/trades",                       label: "Journal"   },
  { href: "/upload-trade",                 label: "Import"    },
  { href: "/checklist",                    label: "Checklist" },
  { href: "/setups",                       label: "Setups"    },
  { href: "/intelligence",                 label: "Intelligence" },
  { href: "/analytics",                    label: "Analytics" },
  { href: "/weekly-reports?market=Forex",  label: "Reports"   },
  { href: "/profile",                      label: "Settings"  },
];

export default function PageHeader({
  showMarketSwitcher = true,
  showClock = false,
  clock = "",
  rightSlot = null,
}) {
  const router   = useRouter();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { profile } = useUserProfile();

  const handleLogout = async () => {
    try { await apiClient.post("/auth/logout"); } catch {}
    await clearAuthToken();
    await signOutFirebase();
    router.push("/login");
  };

  const isActive = (href) => pathname === href || pathname?.startsWith(href.split("?")[0]);

  return (
    <>
      <header style={{
        position: "sticky", top: 0, zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px", height: 60,
        background: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(16px)",
        borderBottom: "1px solid #E8EDF2",
        boxShadow: "0 1px 0 rgba(15,25,35,0.06)",
      }}>

        {/* Logo */}
        <Link href="/dashboard" style={{ textDecoration: "none", flexShrink: 0 }}>
          <img src="/mainlogo1.png" alt="Edgecipline"
            style={{ width: 130, height: 36, objectFit: "contain", display: "block" }} />
        </Link>

        {/* Desktop nav */}
        <div className="hdr-desktop" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <nav id="tour-nav" style={{ display: "flex", alignItems: "center", gap: 2, marginRight: 8 }}>
            {NAV_LINKS.map(n => {
              const active = isActive(n.href);
              const tourId = `tour-nav-${n.label.toLowerCase()}`;
              return (
                <Link key={n.href} href={n.href} id={tourId} className="hdr-link"
                  style={{
                    fontSize: 13, fontWeight: active ? 700 : 500,
                    color: active ? "#0D9E6E" : "#4A5568",
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

          {showMarketSwitcher && <span id="tour-market-switcher"><MarketSwitcher /></span>}

          {showClock && clock && (
            <div style={{
              fontFamily: "'JetBrains Mono',monospace", fontSize: 11,
              color: "#64748B", background: "#F8FAFC",
              border: "1px solid #E2E8F0", borderRadius: 6,
              padding: "4px 10px", marginLeft: 8,
            }}>
              {clock}
            </div>
          )}

          {rightSlot}

          <button onClick={handleLogout} title="Logout" style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 36, height: 36, marginLeft: 8,
            background: "transparent", border: "1px solid #E2E8F0",
            borderRadius: 8, cursor: "pointer",
            color: "#94A3B8", transition: "all 0.15s",
          }} className="hdr-logout">
            <LogOut size={15} />
          </button>
        </div>

        {/* Mobile avatar */}
        <button
          className="hdr-mobile"
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
        navItems={NAV_LINKS}
        extraSlot={showMarketSwitcher ? <MarketSwitcher /> : null}
      />

      <style jsx>{`
        .hdr-link:hover {
          background: rgba(13,158,110,0.06) !important;
          color: #0D9E6E !important;
        }
        .hdr-logout:hover {
          color: #D63B3B !important;
          border-color: rgba(214,59,59,0.3) !important;
          background: rgba(214,59,59,0.05) !important;
        }
        @media (max-width: 768px) {
          .hdr-desktop { display: none !important; }
          .hdr-mobile  { display: flex !important; }
        }
        @media (min-width: 769px) {
          .hdr-mobile  { display: none !important; }
        }
      `}</style>
    </>
  );
}
