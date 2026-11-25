"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, LifeBuoy, LogOut, X } from "lucide-react";
import { isNavActive } from "@/features/shared/navigation";
import { registerDismissable } from "@/utils/backNavigation";

// Phone menu sheet opened from the header avatar.
//
// Layout: a header that never scrolls (profile + close), then the eight main
// sections as a 4x2 tile grid, the market switcher, and a grouped list for
// the account-level pages. Sized to fit a normal phone without scrolling; the
// body scrolls on its own only on very short screens, so the header and the
// sheet's rounded top edge always stay in view.
//
// Styles live in design-system.css (.ec-drawer__*) and use theme tokens, so
// light and dark both work.

function getInitials(name) {
  if (!name) return "T";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function MobileUserDrawer({
  open,
  onClose,
  onLogout,
  profile,
  navItems = [],
  secondaryItems = [],
  extraSlot,
  paymentSlot,
}) {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [animate, setAnimate] = useState(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => {
        setVisible(true);
        requestAnimationFrame(() => setAnimate(true));
      });
      return () => cancelAnimationFrame(raf);
    }
    const animateTimer = setTimeout(() => setAnimate(false), 0);
    const visibleTimer = setTimeout(() => setVisible(false), 320);
    return () => {
      clearTimeout(animateTimer);
      clearTimeout(visibleTimer);
    };
  }, [open]);

  // While open: page behind does not scroll, Escape and the Android back
  // gesture close the sheet instead of navigating (same as BottomSheet).
  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    const onKeyDown = (event) => {
      if (event.key === "Escape") onCloseRef.current?.();
    };
    window.addEventListener("keydown", onKeyDown);
    const unregisterBack = registerDismissable(() => onCloseRef.current?.());
    return () => {
      body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      unregisterBack();
    };
  }, [open]);

  if (!visible) return null;

  const helpActive = isNavActive(pathname, "/support");
  const accountItems = [
    ...secondaryItems,
    { href: "/support", label: "Help & Support", icon: <LifeBuoy size={18} />, active: helpActive },
  ];

  return (
    <>
      <div
        className={`ec-drawer__backdrop${animate ? " is-open" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className={`ec-drawer${animate ? " is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
      >
        <div className="ec-drawer__head">
          <div className="ec-drawer__handle" aria-hidden="true" />
          <div className="ec-drawer__profile">
            <div className="ec-drawer__avatar" aria-hidden="true">{getInitials(profile?.name)}</div>
            <div className="ec-drawer__who">
              <div className="ec-drawer__name-row">
                <span className="ec-drawer__name">{profile?.name || "Trader"}</span>
                {profile && (
                  <span className={`ec-drawer__plan${profile.isPremium ? " is-pro" : ""}`}>
                    {profile.isPremium ? "Pro" : "Free"}
                  </span>
                )}
              </div>
              {profile?.email && <div className="ec-drawer__email">{profile.email}</div>}
            </div>
            <button type="button" className="ec-drawer__close" onClick={onClose} aria-label="Close menu">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="ec-drawer__body">
          <nav aria-label="Sections">
            <ul className="ec-drawer__grid">
              {navItems.map((item) => {
                const active = isNavActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      className={`ec-drawer__tile${active ? " is-active" : ""}`}
                      aria-current={active ? "page" : undefined}
                    >
                      <span className="ec-drawer__tile-icon">{item.icon}</span>
                      <span className="ec-drawer__tile-label">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {extraSlot && (
            <section className="ec-drawer__section">
              <div className="ec-drawer__label">Market</div>
              {extraSlot}
            </section>
          )}

          {/* Help & Support is added here rather than in secondaryItems: it is
              reachable from every workspace and works without a session. */}
          <section className="ec-drawer__section">
            <div className="ec-drawer__label">Account</div>
            <ul className="ec-drawer__list">
              {accountItems.map((item) => {
                const active = item.active ?? isNavActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      className={`ec-drawer__row${active ? " is-active" : ""}`}
                      aria-current={active ? "page" : undefined}
                    >
                      <span className="ec-drawer__row-icon">{item.icon}</span>
                      <span className="ec-drawer__row-label">{item.label}</span>
                      <ChevronRight size={16} className="ec-drawer__chev" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          {paymentSlot && <div className="ec-drawer__section">{paymentSlot}</div>}

          <button
            type="button"
            className="ec-drawer__signout"
            onClick={() => { onClose(); onLogout(); }}
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </div>
    </>
  );
}
