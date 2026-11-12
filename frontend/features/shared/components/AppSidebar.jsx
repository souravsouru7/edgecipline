"use client";

import { memo, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CreditCard, HelpCircle, LogOut, Moon, Plus, Sun } from "lucide-react";
import { useMarket } from "@/context/MarketContext";
import { useUserProfile } from "@/features/auth/hooks/useUserProfile";
import { useLogout } from "@/features/auth/hooks/useLogout";
import { useLogTrade } from "@/features/trade/components/LogTradeChooser";
import PricingModal from "@/components/PricingModal";
import { canShowPurchaseUI } from "@/config/payments";
import { hasValidAuthToken } from "@/utils/auth";
import { useTheme } from "@/utils/theme";
import { isChromeless, isNavActive, marketRoutes, primaryNav, secondaryNav } from "@/features/shared/navigation";

// Desktop/laptop navigation (≥1024px). Full 248px at ≥1280px, a 72px icon
// rail at 1024–1279px (labels become tooltips). Rendered once in the root
// layout; every page is offset by CSS (`body.has-app-sidebar`), so legacy
// pages need no changes. Phones and small tablets keep the header drawer +
// bottom tabs.

function initials(name) {
  if (!name) return "T";
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts.at(-1)[0] : "")).toUpperCase();
}

function NavItem({ item, active }) {
  const { Icon } = item;
  return (
    <Link
      href={item.href}
      className="app-sidebar__item ec-focusable"
      aria-current={active ? "page" : undefined}
      title={`${item.label} — ${item.hint}`}
    >
      <Icon size={19} strokeWidth={active ? 2.3 : 1.9} aria-hidden="true" />
      <span className="app-sidebar__label">{item.label}</span>
    </Link>
  );
}

function SidebarPanel({ pathname }) {
  const router = useRouter();
  const { currentMarket } = useMarket();
  const { profile } = useUserProfile();
  const logout = useLogout();
  const { open: openLogTrade } = useLogTrade();
  const [pricingOpen, setPricingOpen] = useState(false);
  // Page offset + header trimming key off this class (design-system.css,
  // PageHeader). A class, not :has(), so older browsers lay out correctly.
  useEffect(() => {
    document.body.classList.add("has-app-sidebar");
    return () => document.body.classList.remove("has-app-sidebar");
  }, []);
  const { theme, setPreference } = useTheme();
  const nextTheme = theme === "dark" ? "light" : "dark";

  const routes = marketRoutes(currentMarket);
  const showUpgrade = canShowPurchaseUI() && profile && !profile.isPremium;

  return (
    <aside className="app-sidebar" aria-label="Main navigation">
      <Link href={routes.home} className="app-sidebar__brand" aria-label="Edgecipline home">
        <img src="/logo.png" alt="" width={28} height={28} />
        <span className="app-sidebar__label app-sidebar__wordmark">Edgecipline</span>
      </Link>

      <button type="button" className="ec-btn ec-btn--primary app-sidebar__cta" onClick={openLogTrade} title="Log a trade">
        <Plus size={18} aria-hidden="true" />
        <span className="app-sidebar__label">Log trade</span>
      </button>

      <nav className="app-sidebar__nav">
        {primaryNav(currentMarket).map((item) => (
          <NavItem key={item.key} item={item} active={isNavActive(pathname, item.href)} />
        ))}
      </nav>

      <div className="app-sidebar__footer">
        {showUpgrade && (
          <button type="button" className="app-sidebar__upgrade ec-focusable" onClick={() => setPricingOpen(true)} title="Upgrade to Pro">
            <CreditCard size={18} aria-hidden="true" />
            <span className="app-sidebar__label">
              <strong>Upgrade to Pro</strong>
              <small>Unlimited trades and coaching</small>
            </span>
          </button>
        )}
        {secondaryNav(currentMarket).map((item) => (
          <NavItem key={item.key} item={item} active={isNavActive(pathname, item.href)} />
        ))}
        <NavItem item={{ key: "help", href: routes.help, label: "Help", Icon: HelpCircle, hint: "Guides and support" }} active={isNavActive(pathname, routes.help)} />

        <div className="app-sidebar__user">
          <button type="button" className="app-sidebar__avatar" onClick={() => router.push(routes.settings)} title="Account settings">
            {initials(profile?.name)}
          </button>
          <span className="app-sidebar__label app-sidebar__who">
            <strong>{profile?.name || "Trader"}</strong>
            <small>{profile?.isPremium ? "Pro" : "Free plan"}</small>
          </span>
          <button
            type="button"
            className="app-sidebar__iconbtn app-sidebar__label ec-focusable"
            onClick={() => setPreference(nextTheme)}
            aria-label={`Switch to ${nextTheme} mode`}
            title={`Switch to ${nextTheme} mode`}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button type="button" className="app-sidebar__logout app-sidebar__iconbtn app-sidebar__label ec-focusable" onClick={logout} aria-label="Log out" title="Log out">
            <LogOut size={16} />
          </button>
        </div>
      </div>

      {canShowPurchaseUI() && (
        <PricingModal isOpen={pricingOpen} onClose={() => setPricingOpen(false)} onSuccess={() => router.refresh()} />
      )}
    </aside>
  );
}

// Signed-in screens only. The profile query is not auth-gated, so mounting the
// panel for a signed-out visitor (e.g. on /support) would fire a 401. Checked
// after mount and on every route change (the token hydrates asynchronously
// on native).
function AppSidebar() {
  const pathname = usePathname() || "";
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    const check = () => setAuthed(hasValidAuthToken());
    // Now, plus one late re-check for a token that hydrates after first paint.
    const timers = [setTimeout(check, 0), setTimeout(check, 1500)];
    return () => timers.forEach(clearTimeout);
  }, [pathname]);
  if (!authed || isChromeless(pathname)) return null;
  return <SidebarPanel pathname={pathname} />;
}

export default memo(AppSidebar);
