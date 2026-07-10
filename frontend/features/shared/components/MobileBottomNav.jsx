"use client";

import { memo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BookOpen,
  Plus,
  Brain,
  User,
} from "lucide-react";
import { useMarket, MARKETS } from "@/context/MarketContext";

// Hide bottom nav on these paths — auth flows, legal pages, admin portal,
// and any /add-trade or /upload-trade screen (those have their own focused
// chrome and shouldn't compete with a tab bar).
const HIDDEN_PATH_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-otp",
  "/accept-terms",
  "/admin",
  "/terms",
  "/privacy-policy",
  "/support",
  "/add-trade",
  "/upload-trade",
  "/indian-market/add-trade",
  "/indian-market/upload-trade",
];

const FOREX_TABS = [
  { href: "/dashboard",    label: "Home",         Icon: LayoutDashboard },
  { href: "/trades",       label: "Journal",      Icon: BookOpen },
  { href: "/upload-trade", label: "Add",          Icon: Plus,  primary: true },
  { href: "/intelligence", label: "Intelligence", Icon: Brain },
  { href: "/profile",      label: "Profile",      Icon: User },
];

const INDIAN_TABS = [
  { href: "/indian-market/dashboard", label: "Home",      Icon: LayoutDashboard },
  { href: "/indian-market/trades",    label: "Journal",   Icon: BookOpen },
  { href: "/indian-market/upload-trade", label: "Add",     Icon: Plus, primary: true },
  { href: "/indian-market/analytics", label: "Analytics", Icon: Brain },
  { href: "/profile",                 label: "Profile",   Icon: User },
];

const NAV_HEIGHT = 64;
const ACCENT = "var(--color-primary)";
const MUTED = "var(--color-text-disabled)";

function MobileBottomNav() {
  const pathname = usePathname() || "";
  const { currentMarket } = useMarket();

  if (HIDDEN_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return null;
  }
  if (pathname === "/") return null;

  const isIndian = pathname.startsWith("/indian-market") || currentMarket === MARKETS.INDIAN_MARKET;
  const TABS = isIndian ? INDIAN_TABS : FOREX_TABS;

  return (
    <>
      <nav
        className="mobile-bottom-nav"
        role="navigation"
        aria-label="Primary"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 900,
          background: "rgba(240,238,233,0.97)",
          borderTop: "1px solid var(--color-border-subtle)",
          paddingBottom: "env(safe-area-inset-bottom)",
          justifyContent: "space-around",
          alignItems: "stretch",
          height: `calc(${NAV_HEIGHT}px + env(safe-area-inset-bottom))`,
        }}
      >
        {TABS.map(({ href, label, Icon, primary }) => {
          const active =
            pathname === href ||
            (href !== "/dashboard" && href !== "/indian-market/dashboard" && pathname.startsWith(href + "/")) ||
            (href === "/dashboard" && pathname === "/dashboard") ||
            (href === "/indian-market/dashboard" && pathname === "/indian-market/dashboard");

          if (primary) {
            return (
              <Link
                key={href}
                href={href}
                aria-label={label}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textDecoration: "none",
                  minWidth: 0,
                  height: NAV_HEIGHT,
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 50,
                    height: 50,
                    borderRadius: "50%",
                    background: ACCENT,
                    color: "var(--color-surface)",
                    boxShadow: "0 8px 20px var(--color-primary-shadow)",
                    transform: "translateY(-12px)",
                  }}
                >
                  <Icon size={24} strokeWidth={2.4} />
                </span>
              </Link>
            );
          }

          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                textDecoration: "none",
                color: active ? ACCENT : MUTED,
                fontSize: 10.5,
                fontWeight: active ? 700 : 500,
                fontFamily: "var(--font-plus-jakarta-sans)",
                letterSpacing: "0.01em",
                minWidth: 0,
                height: NAV_HEIGHT,
                transition: "color 0.15s ease",
              }}
            >
              <Icon size={22} strokeWidth={active ? 2.4 : 2} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
      {/* Spacer so page content can't be hidden behind the fixed nav.
          Only rendered on mobile via CSS below. */}
      <div className="mobile-bottom-nav-spacer" aria-hidden="true" />

      <style jsx global>{`
        .mobile-bottom-nav,
        .mobile-bottom-nav-spacer {
          display: none;
        }
        @media (max-width: 768px) {
          .mobile-bottom-nav {
            display: flex;
          }
          .mobile-bottom-nav-spacer {
            display: block;
            height: calc(${NAV_HEIGHT}px + env(safe-area-inset-bottom));
          }
        }
      `}</style>
    </>
  );
}

export default memo(MobileBottomNav);
