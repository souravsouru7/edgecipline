"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Menu, X, LogOut } from "lucide-react";
import MarketSwitcher from "@/components/MarketSwitcher";
import { signOutFirebase } from "@/services/firebaseAuth";
import apiClient from "@/services/apiClient";
import { clearAuthToken } from "@/utils/auth";

const NAV_ITEMS = [
  { href: "/indian-market/dashboard", label: "Dashboard" },
  { href: "/indian-market/trades",    label: "Journal"   },
  { href: "/indian-market/add-trade",    label: "Log Trade"    },
  { href: "/indian-market/analytics", label: "Analytics" },
  { href: "/indian-market/setups",    label: "Setups"    },
  { href: "/profile",                 label: "Profile"   },
  { href: "/weekly-reports?market=Indian_Market", label: "Reports" },
];

export default function IndianMarketHeader() {
  const router   = useRouter();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isActive = (href) => {
    const base = href.split("?")[0];
    return pathname === base || (base !== "/indian-market/dashboard" && pathname.startsWith(base));
  };

  const handleLogout = async () => {
    try { await apiClient.post("/auth/logout"); } catch {}
    clearAuthToken();
    await signOutFirebase();
    router.push("/login");
  };

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

        {/* Mobile hamburger */}
        <button className="im-hdr-mobile"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          style={{ background: "none", border: "1px solid #E2E8F0", borderRadius: 8, padding: "10px 12px", cursor: "pointer", color: "#4A5568", display: "flex", alignItems: "center", justifyContent: "center", minWidth: 44, minHeight: 44 }}>
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div style={{
          position: "fixed", top: 60, left: 0, right: 0, bottom: 0,
          background: "#FFFFFF", zIndex: 999,
          display: "flex", flexDirection: "column",
          borderTop: "1px solid #E8EDF2",
          overflowY: "auto",
        }}>
          <div style={{ padding: "24px 24px 0" }}>
            <div style={{ fontSize: 10, color: "#94A3B8", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 12 }}>NAVIGATION</div>
            <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {NAV_ITEMS.map(n => {
                const active = isActive(n.href);
                return (
                  <Link key={n.href} href={n.href}
                    onClick={() => setMobileMenuOpen(false)}
                    style={{
                      fontSize: 16, fontWeight: active ? 700 : 500,
                      color: active ? "#0D9E6E" : "#2D3748",
                      textDecoration: "none",
                      padding: "12px 16px", borderRadius: 8,
                      background: active ? "rgba(13,158,110,0.06)" : "transparent",
                    }}>
                    {n.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div style={{ height: 1, background: "#E8EDF2", margin: "20px 0" }} />

          <div style={{ padding: "0 24px" }}>
            <div style={{ fontSize: 10, color: "#94A3B8", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 12 }}>MARKET</div>
            <MarketSwitcher />
          </div>

          <button onClick={handleLogout} style={{
            margin: "auto 24px 32px",
            display: "flex", alignItems: "center", gap: 10,
            background: "#FFF5F5", border: "1px solid #FED7D7",
            color: "#C53030", padding: "14px 20px",
            borderRadius: 10, fontWeight: 600, fontSize: 15, cursor: "pointer",
          }}>
            <LogOut size={18} /> Sign out
          </button>
        </div>
      )}

      <style jsx>{`
        .im-hdr-link:hover {
          background: rgba(13,158,110,0.06) !important;
          color: #0D9E6E !important;
        }
        .im-hdr-logout:hover {
          color: #D63B3B !important;
          border-color: rgba(214,59,59,0.3) !important;
          background: rgba(214,59,59,0.05) !important;
        }
        @media (max-width: 768px) {
          .im-hdr-desktop { display: none !important; }
          .im-hdr-mobile  { display: flex !important; }
        }
        @media (min-width: 769px) {
          .im-hdr-mobile { display: none !important; }
        }
      `}</style>
    </>
  );
}
