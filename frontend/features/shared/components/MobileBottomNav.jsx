"use client";

import { memo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, HelpCircle, LayoutGrid, Plus } from "lucide-react";
import { useMarket } from "@/context/MarketContext";
import { isChromeless, isNavActive, marketRoutes, primaryNav, secondaryNav } from "@/features/shared/navigation";
import { useLogTrade } from "@/features/trade/components/LogTradeChooser";
import { selection } from "@/utils/haptics";
import { ResponsiveModal } from "@/features/shared/components/ui";

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

// Tabs: Home · Journal · [+ Log] · Coach · More. Same in both markets; the
// destinations come from features/shared/navigation. "+" opens the shared
// log-trade chooser; "More" opens a sheet with every other section.
const TAB_KEYS = ["home", "journal", "LOG", "coach", "MORE"];

// Keep in sync with .mobile-bottom-nav height in app/design-system.css.
const NAV_HEIGHT = 68;

function MobileBottomNav() {
  const pathname = usePathname() || "";
  const { currentMarket } = useMarket();
  const { open: openLogTrade } = useLogTrade();
  const [moreOpen, setMoreOpen] = useState(false);

  // Also every full-screen route (onboarding, legal, public share…): the tab
  // bar showed on /onboarding and let a new user leave setup half-way.
  if (isChromeless(pathname) || HIDDEN_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return null;
  }
  if (pathname === "/") return null;

  const nav = primaryNav(currentMarket);
  const byKey = Object.fromEntries(nav.map((n) => [n.key, n]));
  const moreItems = [
    ...nav.filter((n) => !["home", "journal", "coach"].includes(n.key)),
    ...secondaryNav(currentMarket),
    { key: "help", href: marketRoutes(currentMarket).help, label: "Help", Icon: HelpCircle, hint: "Guides and support" },
  ];
  const moreActive = moreItems.some((n) => isNavActive(pathname, n.href));
  const TABS = TAB_KEYS.map((k) =>
    k === "LOG" ? { key: k, label: "Log", Icon: Plus, primary: true, onClick: openLogTrade }
    : k === "MORE" ? { key: k, label: "More", Icon: LayoutGrid, onClick: () => setMoreOpen(true), activeOverride: moreActive }
    : { ...byKey[k], label: k === "journal" ? "Journal" : byKey[k].label },
  );

  return (
    <>
      <nav className="mobile-bottom-nav" aria-label="Primary">
        {TABS.map(({ key, href, label, Icon, primary, onClick, activeOverride }) => {
          const active = href ? isNavActive(pathname, href) : Boolean(activeOverride);
          const Tag = href ? Link : "button";
          const handle = () => {
            // A light native tick on a real change of tab, like system tab bars.
            if (!active) void selection();
            onClick?.();
          };
          return (
            <Tag
              key={key}
              {...(href ? { href, onClick: handle } : { type: "button", onClick: handle })}
              className={`ec-tab${primary ? " ec-tab--primary" : ""}${active ? " is-active" : ""}`}
              aria-label={primary ? "Log a trade" : label}
              aria-current={active ? "page" : undefined}
            >
              <span className={primary ? "mobile-bottom-nav-primary ec-tab__fab" : "ec-tab__icon"} aria-hidden="true">
                <Icon size={primary ? 24 : 22} strokeWidth={primary || active ? 2.4 : 1.9} />
              </span>
              <span className="ec-tab__label">{label}</span>
            </Tag>
          );
        })}
      </nav>
      <ResponsiveModal open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <ul className="ec-more">
          {moreItems.map(({ key, href, label, Icon, hint }) => (
            <li key={key}>
              <Link href={href} className="ec-more__row ec-focusable" onClick={() => setMoreOpen(false)}
                aria-current={isNavActive(pathname, href) ? "page" : undefined}>
                <span className="ec-more__icon"><Icon size={19} /></span>
                <span className="ec-more__text"><strong>{label}</strong><small>{hint}</small></span>
                <ChevronRight size={18} className="ec-more__chev" />
              </Link>
            </li>
          ))}
        </ul>
      </ResponsiveModal>
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
            height: calc(${NAV_HEIGHT}px + env(safe-area-inset-bottom, 0px));
          }
        }
      `}</style>
    </>
  );
}

export default memo(MobileBottomNav);
