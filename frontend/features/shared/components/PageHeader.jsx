"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { CreditCard, LogOut } from "lucide-react";
import MarketSwitcher from "@/components/MarketSwitcher";
import { MARKET_SWITCH_TIMING } from "@/context/marketTransition";
import PricingModal from "@/components/PricingModal";
import TrialCountdownBanner from "@/components/TrialCountdownBanner";
import RescueBanner from "@/components/RescueBanner";
import { useMarket, MARKETS } from "@/context/MarketContext";
import { useUserProfile } from "@/features/auth/hooks/useUserProfile";
import MobileUserDrawer from "./MobileUserDrawer";
import { useLogout } from "@/features/auth/hooks/useLogout";
import { primaryNav, secondaryNav } from "@/features/shared/navigation";
import { canShowPurchaseUI } from "@/config/payments";

function getInitials(name) {
  if (!name) return "T";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}


export default function PageHeader({
  showMarketSwitcher = true,
  showClock = false,
  clock = "",
  rightSlot = null,
  // Redesigned screens (wrapped in .ec-app) pass `themed` so the header
  // follows the design-system tokens and the dark/light preference. Legacy
  // screens keep the original light header until they are migrated.
  themed = false,
  // Page name shown in place of the logo when the desktop sidebar is present.
  title = "",
}) {
  const bar = themed ? "var(--ec-bg)" : "rgba(240,238,233,0.97)";
  const router   = useRouter();
  const pathname = usePathname();
  const handleLogout = useLogout();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const { profile } = useUserProfile();
  // Prompting a paying customer to upgrade reads as the app not knowing they
  // paid. `isPremium` is resolved server-side (paid plan or admin) so the UI
  // never re-derives entitlement rules.
  const showUpgrade = canShowPurchaseUI() && !profile?.isPremium;
  const { currentMarket } = useMarket();
  const isIndianMarket = currentMarket === MARKETS.INDIAN_MARKET;
  // Same destinations as the sidebar and bottom tabs (features/shared/navigation).
  const navLinks = [...primaryNav(currentMarket), ...secondaryNav(currentMarket)].map(
    ({ href, label, Icon }) => ({ href, label, icon: <Icon size={16} /> }),
  );
  const dashboardHref = isIndianMarket ? "/indian-market/dashboard" : "/dashboard";

  // Phones: once the page's big title scrolls under the bar, show it in the
  // bar instead of the logo (the iOS large-title pattern), so the screen name
  // is always visible.
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (!themed || !title || typeof IntersectionObserver === "undefined") return undefined;
    let observer;
    let tries = 0;
    let timer;
    const attach = () => {
      const target = document.querySelector("main h1");
      if (!target) {
        if (tries++ < 10) timer = setTimeout(attach, 250);
        return;
      }
      observer = new IntersectionObserver(
        ([entry]) => setCompact(!entry.isIntersecting && entry.boundingClientRect.top < 80),
        { rootMargin: "-72px 0px 0px 0px", threshold: 0 },
      );
      observer.observe(target);
    };
    attach();
    return () => {
      clearTimeout(timer);
      observer?.disconnect();
      setCompact(false);
    };
  }, [themed, title, pathname]);

  const isActive = (href) => {
    const base = href.split("?")[0];
    return pathname === base || (base !== "/" && pathname?.startsWith(`${base}/`));
  };

  return (
    <>
      {/* ── Top safe area, owned here and only here ────────────────────────
          viewport-fit=cover means the iOS WebView runs under the status bar and
          Dynamic Island, so something has to account for inset-top. It used to be
          the <header> below, via padding-top — which is correct ONLY while the
          header is the topmost element. It is not: the two banners render above
          it, so a user in trial or in the rescue funnel got banner text under the
          Island AND a stray inset-sized gap inside the header further down.

          The inset now belongs to a spacer that is unconditionally first in flow,
          so exactly one element consumes it however many banners are visible.

          Every value here is env(..., 0px): on Android the status bar does not
          overlay the WebView (useSystemBars sets overlay:false) and on web there
          is no inset, so all of this collapses to 0 and the rendered box is
          identical to before. */}
      <div
        aria-hidden="true"
        style={{
          // Paints the strip behind the status bar so page content scrolling up
          // underneath it is covered rather than showing through beside the clock
          // and battery icons. z-index 999 keeps it below the sticky header
          // (1000) and below every modal overlay (1000+), which would otherwise
          // get a light strip across their top edge.
          position: "fixed", top: 0, left: 0, right: 0,
          height: "env(safe-area-inset-top, 0px)",
          background: bar,
          zIndex: 999,
          pointerEvents: "none",
        }}
      />
      <div aria-hidden="true" style={{ height: "env(safe-area-inset-top, 0px)" }} />

      <TrialCountdownBanner onUpgrade={() => setPricingOpen(true)} />
      <RescueBanner onUpgrade={() => setPricingOpen(true)} />
      <header style={{
        // Sticks BELOW the status bar, not under it. With top:0 the pinned header
        // slid beneath the Island as soon as the page scrolled.
        position: "sticky", top: "env(safe-area-inset-top, 0px)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        // No top inset here any more — the spacer above owns it. Left/right stay:
        // in landscape on a notched iPhone these are what keep the logo and the
        // menu button clear of the rounded corners and the camera housing.
        padding: "0 calc(20px + env(safe-area-inset-right, 0px)) 0 calc(20px + env(safe-area-inset-left, 0px))",
        height: 60,
        minHeight: 60,
        background: bar,
        borderBottom: themed ? "1px solid var(--ec-border)" : "1px solid var(--color-border-subtle)",
        boxShadow: themed ? "none" : "0 1px 0 rgba(15,25,35,0.06)",
      }} className={themed ? `hdr-themed${compact ? " is-compact" : ""}` : undefined}>

        {/* Logo. The wordmark image has black lettering, so themed headers use
            the green mark + live text, which follows the theme. */}
        {title && <h1 className="hdr-title">{title}</h1>}
        <Link href={dashboardHref} className="hdr-logo" style={{ textDecoration: "none", flexShrink: 0 }}>
          {themed ? (
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <img src="/logo.png" alt="" width={28} height={28} style={{ display: "block" }} />
              <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--ec-text)" }}>
                Edgecipline
              </span>
            </span>
          ) : (
            <img src="/mainlogo1.webp" alt="Edgecipline"
              style={{ width: 130, height: 36, objectFit: "contain", display: "block" }} />
          )}
        </Link>

        {/* Desktop nav */}
        <div className="hdr-desktop" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <nav id="tour-nav" className="hdr-nav" style={{ display: "flex", alignItems: "center", gap: 2, marginRight: 8 }}>
            {navLinks.map(n => {
              const active = isActive(n.href);
              const tourId = `tour-nav-${n.label.toLowerCase()}`;
              return (
                <Link key={n.href} href={n.href} id={tourId} className="hdr-link"
                  aria-current={active ? "page" : undefined}
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

          <div className="hdr-sep" style={{ width: 1, height: 20, background: "var(--color-border)", margin: "0 8px" }} />

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

          {showUpgrade && (
            <button
              className="hdr-upgrade"
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
          )}

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
        navItems={primaryNav(currentMarket).map(({ href, label, Icon }) => ({ href, label, icon: <Icon size={20} /> }))}
        secondaryItems={secondaryNav(currentMarket).map(({ href, label, Icon }) => ({ href, label, icon: <Icon size={18} /> }))}
        extraSlot={showMarketSwitcher ? (
          // Let the pill finish gliding before the drawer slides away, so the
          // new market's dashboard is what the closing drawer reveals.
          <MarketSwitcher onSwitch={() => setTimeout(() => setDrawerOpen(false), MARKET_SWITCH_TIMING.pill)} />
        ) : null}
        paymentSlot={showUpgrade ? (
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
        ) : null}
      />

      {canShowPurchaseUI() && (
        <PricingModal
          isOpen={pricingOpen}
          onClose={() => setPricingOpen(false)}
          onSuccess={() => router.refresh()}
        />
      )}

      <style jsx global>{`
        /* Themed header (redesigned screens): token colours, overriding the
           legacy inline values above. */
        .hdr-themed .hdr-link { color: var(--ec-text-2) !important; background: transparent !important; }
        .hdr-themed .hdr-link[aria-current="page"] {
          color: var(--ec-text) !important; background: var(--ec-surface-2) !important;
        }
        .hdr-themed .hdr-link:hover { color: var(--ec-text) !important; background: var(--ec-surface-2) !important; }
        .hdr-themed .hdr-desktop > div[style] { background: var(--ec-border-strong) !important; }
        .hdr-themed .hdr-upgrade {
          background: var(--ec-accent) !important; border-color: var(--ec-accent) !important;
          color: var(--ec-on-accent) !important;
        }
        .hdr-themed .hdr-logout { border-color: var(--ec-border-strong) !important; color: var(--ec-text-3) !important; }
        .hdr-themed .hdr-mobile {
          background: var(--ec-surface-2) !important; color: var(--ec-text) !important;
          border: 1px solid var(--ec-border-strong) !important; box-shadow: none !important;
          width: 40px !important; height: 40px !important; min-height: 40px !important;
        }
      `}</style>
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
        @media (max-width: 1439px) {
          .hdr-desktop { display: none !important; }
          .hdr-mobile  { display: flex !important; }
        }
        @media (min-width: 1440px) {
          .hdr-mobile  { display: none !important; }
        }
      `}</style>
      <style jsx global>{`
        /* With the desktop sidebar on screen it owns the logo, links, upgrade
           and logout; the header keeps banners, page title and the market
           switcher. (AppSidebar sets body.has-app-sidebar; it shows at >= 1024px, signed in.) */
        .hdr-title { display: none; margin: 0; font-size: 1.125rem; font-weight: 700; letter-spacing: -0.01em; }
        /* Phones/tablets: the page title slides into the bar when the page's
           own heading has scrolled away (see the IntersectionObserver). */
        @media (max-width: 1023px) {
          .hdr-themed .hdr-title {
            display: block; position: absolute;
            left: calc(20px + env(safe-area-inset-left, 0px)); right: 132px;
            font-size: 17px; font-weight: 600; color: var(--ec-text);
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            opacity: 0; transform: translateY(6px); pointer-events: none;
            transition: opacity .18s ease, transform .18s ease;
          }
          .hdr-themed .hdr-logo { transition: opacity .18s ease; }
          .hdr-themed.is-compact .hdr-title { opacity: 1; transform: none; }
          .hdr-themed.is-compact .hdr-logo { opacity: 0; pointer-events: none; }
        }
        @media (max-width: 1023px) and (prefers-reduced-motion: reduce) {
          .hdr-themed .hdr-title, .hdr-themed .hdr-logo { transition: none; }
        }
        @media (min-width: 1024px) {
          body.has-app-sidebar .hdr-logo,
          body.has-app-sidebar .hdr-nav,
          body.has-app-sidebar .hdr-sep,
          body.has-app-sidebar .hdr-upgrade,
          body.has-app-sidebar .hdr-logout,
          body.has-app-sidebar .hdr-mobile { display: none !important; }
          body.has-app-sidebar .hdr-desktop { display: flex !important; margin-left: auto; }
          body.has-app-sidebar .hdr-title { display: block; color: var(--color-dark); }
          body.has-app-sidebar .hdr-themed .hdr-title { color: var(--ec-text); }
        }
      `}</style>
    </>
  );
}
