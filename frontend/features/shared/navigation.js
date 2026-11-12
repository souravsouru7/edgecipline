import {
  BarChart3, Bell, BookOpen, CheckSquare, FileText, Home, MessageCircle, Settings, Sparkles, Target,
} from "lucide-react";
import { MARKETS } from "@/context/MarketContext";

// Single source of truth for app navigation. Used by the desktop sidebar,
// the phone bottom tabs + "More" sheet, and the avatar drawer — so every
// surface shows the same destinations with the same names.
//
// `hint` is the one-line "what is this page for" shown as a tooltip and in
// the More sheet, so a first-time user can tell the sections apart.

export function marketRoutes(market) {
  const indian = market === MARKETS.INDIAN_MARKET;
  return {
    home: indian ? "/indian-market/dashboard" : "/dashboard",
    journal: indian ? "/indian-market/trades" : "/trades",
    addTrade: indian ? "/indian-market/add-trade" : "/add-trade",
    uploadTrade: indian ? "/indian-market/upload-trade" : "/upload-trade",
    checklist: "/checklist",
    setups: indian ? "/indian-market/setups" : "/setups",
    analytics: indian ? "/indian-market/analytics" : "/analytics",
    insights: indian ? "/indian-market/intelligence" : "/intelligence",
    coach: "/coach",
    reports: `/weekly-reports?market=${indian ? "Indian_Market" : "Forex"}`,
    settings: "/settings",
    notifications: "/notifications",
    help: "/support",
  };
}

export function primaryNav(market) {
  const r = marketRoutes(market);
  return [
    { key: "home", href: r.home, label: "Home", Icon: Home, hint: "Today's next step and how you're doing" },
    { key: "journal", href: r.journal, label: "Journal", Icon: BookOpen, hint: "Every trade you've logged" },
    { key: "checklist", href: r.checklist, label: "Checklist", Icon: CheckSquare, hint: "Check your rules before you take a trade" },
    { key: "setups", href: r.setups, label: "Setups", Icon: Target, hint: "The strategies you trade, written as rules" },
    { key: "analytics", href: r.analytics, label: "Analytics", Icon: BarChart3, hint: "Your numbers: win rate, P&L, patterns" },
    { key: "insights", href: r.insights, label: "Insights", Icon: Sparkles, hint: "AI findings: strengths, leaks, next focus" },
    { key: "coach", href: r.coach, label: "Coach", Icon: MessageCircle, hint: "Ask the AI coach about your trading" },
    { key: "reports", href: r.reports, label: "Reports", Icon: FileText, hint: "Weekly review of your discipline" },
  ];
}

export function secondaryNav(market) {
  const r = marketRoutes(market);
  return [
    // The inbox was only reachable by tapping a push.
    { key: "notifications", href: r.notifications, label: "Notifications", Icon: Bell, hint: "Your alerts and reminders" },
    { key: "settings", href: r.settings, label: "Settings", Icon: Settings, hint: "Account, plan and preferences" },
  ];
}

export function isNavActive(pathname, href) {
  const base = href.split("?")[0];
  if (!pathname) return false;
  return pathname === base || (base !== "/" && pathname.startsWith(`${base}/`));
}

// Screens with no app chrome: auth, onboarding, legal, admin, public share.
export const CHROMELESS_PREFIXES = [
  "/login", "/register", "/forgot-password", "/reset-password", "/verify-otp",
  "/accept-terms", "/onboarding", "/admin", "/terms", "/privacy-policy",
  "/delete-account", "/r", "/trading-dna/share",
];

export function isChromeless(pathname) {
  if (!pathname || pathname === "/") return true;
  return CHROMELESS_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
