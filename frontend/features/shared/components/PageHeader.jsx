"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { CreditCard, LogOut } from "lucide-react";
import MarketSwitcher from "@/components/MarketSwitcher";
import PricingModal from "@/components/PricingModal";
import TrialCountdownBanner from "@/components/TrialCountdownBanner";
import RescueBanner from "@/components/RescueBanner";
import { useMarket, MARKETS } from "@/context/MarketContext";
import { signOutFirebase } from "@/services/firebaseAuth";
import apiClient from "@/services/apiClient";
import { clearAuthToken } from "@/utils/auth";
import { useUserProfile } from "@/features/auth/hooks/useUserProfile";
import MobileUserDrawer from "./MobileUserDrawer";
import { onUserLoggedOut } from "@/services/pushNotifications";

function getInitials(name) {
  if (!name) return "T";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const FOREX_NAV_LINKS = [
  { href: "/dashboard",                    label: "Dashboard" },
  { href: "/trades",                       label: "Trades"    },
  { href: "/upload-trade",                 label: "Import"    },
  { href: "/checklist",                    label: "Checklist" },
  { href: "/setups",                       label: "Setups"    },
  { href: "/intelligence",                 label: "Intelligence" },
  { href: "/analytics",                    label: "Analytics" },
  { href: "/weekly-reports?market=Forex",  label: "Reports"   },
  { href: "/profile",                      label: "Settings"  },
];

const INDIAN_NAV_LINKS = [
  { href: "/dashboard",                           label: "Dashboard" },
  { href: "/indian-market/trades",                label: "Trades"    },
  { href: "/indian-market/upload-trade",          label: "Import"    },
  { href: "/checklist",                           label: "Checklist" },
  { href: "/indian-market/setups",                label: "Setups"    },
  { href: "/intelligence",                        label: "Intelligence" },
  { href: "/indian-market/analytics",             label: "Analytics" },
  { href: "/weekly-reports?market=Indian_Market", label: "Reports"   },
  { href: "/profile",                             label: "Settings"  },
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
  const [pricingOpen, setPricingOpen] = useState(false);
  const { profile } = useUserProfile();
  const { currentMarket } = useMarket();
  const navLinks = currentMarket === MARKETS.INDIAN_MARKET ? INDIAN_NAV_LINKS : FOREX_NAV_LINKS;

  const handleLogout = async () => {
    await onUserLoggedOut();
    try { await apiClient.post("/auth/logout"); } catch {}
    await clearAuthToken();
    await signOutFirebase();
    router.push("/login");
  };

  const isActive = (href) => pathname === href || pathname?.startsWith(href.split("?")[0]);

  return (
    <>
      <TrialCountdownBanner onUpgrade={() => setPricingOpen(true)} />
      <RescueBanner onUpgrade={() => setPricingOpen(true)} />
      <header style={{
        position: "sticky", top: 0, zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "env(safe-area-inset-top, 0px) calc(20px + env(safe-area-inset-right, 0px)) 0 calc(20px + env(safe-area-inset-left, 0px))",
        height: "calc(60px + env(safe-area-inset-top, 0px))",
        minHeight: "calc(60px + env(safe-area-inset-top, 0px))",
        background: "rgba(240,238,233,0.97)",
        borderBottom: "1px solid var(--color-border-subtle)",
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
            {navLinks.map(n => {
              const active = isActive(n.href);
              const tourId = `tour-nav-${n.label.toLowerCase()}`;
              return (
                <Link key={n.href} href={n.href} id={tourId} className="hdr-link"
                  style={{
                    fontSize: 13, fontWeight: active ? 700 : 500,
                    color: active ? "var(--color-primary)" : "var(--color-text-secondary)",
                    textDecoration: "none",
                    padding: "6px 12px", borderRadius: 6,
                    fontFamily: "var(--font-plus-jakarta-sans)",
                    transition: "all 0.15s",
                    background: active ? "var(--color-primary-bg)" : "transparent",
                  }}>
                  {n.label}
                </Link>
              );
            })}
          </nav>

          <div style={{ width: 1, height: 20, background: "var(--color-border)", margin: "0 8px" }} />

          {showMarketSwitcher && <span id="tour-market-switcher"><MarketSwitcher /></span>}

          {showClock && clock && (
            <div style={{
              fontFamily: "'JetBrains Mono',monospace", fontSize: 11,
              color: "var(--color-text-muted)", background: "var(--color-surface-hover)",
              border: "1px solid var(--color-border)", borderRadius: 6,
              padding: "4px 10px", marginLeft: 8,
            }}>
              {clock}
            </div>
          )}

          {rightSlot}

          <button
            onClick={() => setPricingOpen(true)}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              height: 36, marginLeft: 8, padding: "0 12px",
              background: "var(--color-dark)", border: "1px solid var(--color-dark)",
              borderRadius: 8, cursor: "pointer", color: "var(--color-surface)",
              fontSize: 12, fontWeight: 700,
              fontFamily: "var(--font-plus-jakarta-sans)",
            }}
          >
            <CreditCard size={15} />
            Upgrade
          </button>

          <button onClick={handleLogout} title="Logout" style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 36, height: 36, marginLeft: 8,
            background: "transparent", border: "1px solid var(--color-border)",
            borderRadius: 8, cursor: "pointer",
            color: "var(--color-text-disabled)", transition: "all 0.15s",
          }} className="hdr-logout">
            <LogOut size={15} />
          </button>
        </div>

        {/* Mobile avatar */}
        <button
          className="hdr-mobile"
          onClick={() => setDrawerOpen(true)}
          style={{ width: 48, height: 48, borderRadius: "50%", background: "linear-gradient(135deg,var(--color-primary),var(--color-primary-light))", color: "var(--color-surface)", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-plus-jakarta-sans)", boxShadow: "0 4px 10px var(--color-primary-shadow)", flexShrink: 0 }}
        >
          {getInitials(profile?.name)}
        </button>
      </header>

      <MobileUserDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onLogout={handleLogout}
        profile={profile}
        navItems={navLinks}
        extraSlot={showMarketSwitcher ? <MarketSwitcher /> : null}
        paymentSlot={(
          <button
            onClick={() => { setDrawerOpen(false); setPricingOpen(true); }}
            style={{
              width: "100%", height: 46,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
              background: "var(--color-dark)", border: "none", color: "var(--color-surface)",
              borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer",
              fontFamily: "var(--font-plus-jakarta-sans)",
            }}
          >
            <CreditCard size={16} />
            Upgrade plan
          </button>
        )}
      />

      <PricingModal
        isOpen={pricingOpen}
        onClose={() => setPricingOpen(false)}
        onSuccess={() => router.refresh()}
      />

      <style jsx>{`
        .hdr-link:hover {
          background: var(--color-primary-bg) !important;
          color: var(--color-primary) !important;
        }
        .hdr-logout:hover {
          color: var(--color-error) !important;
          border-color: var(--color-error-border) !important;
          background: var(--color-error-bg) !important;
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
