import type { Metadata } from "next";
import "./fonts.css";
import "./globals.css";
import "./mobile-optimizations.css";
import "./design-system.css";
import Providers from "./providers";
import { THEME_BOOT_SCRIPT } from "../utils/themeBoot";
import MobileBottomNav from "@/features/shared/components/MobileBottomNav";
import PullToRefresh from "@/components/PullToRefresh";
import AppShortcuts from "@/components/AppShortcuts";
import AppSidebar from "@/features/shared/components/AppSidebar";
import { LogTradeProvider } from "@/features/trade/components/LogTradeChooser";
import SupportWidget from "@/features/support/components/SupportWidget";

import { getBaseMetadata } from "../config/seo";

export const metadata: Metadata = {
  ...getBaseMetadata(),
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/icons/icon-192.png",
    // iOS home-screen icon must be 180x180; it ignores the manifest.
    apple: [{ url: "/icons/icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Edgecipline",
    startupImage: "/icons/icon-512.png",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport = {
  // The browser/OS chrome colour. Follows the system scheme here; the boot
  // script and utils/theme.js then pin it to the theme the user chose.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F7F5" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0D12" },
  ],
  width: "device-width",
  initialScale: 1,
  // Pinch zoom is allowed (accessibility). maximumScale stays at 1 only to
  // stop iOS zooming on focus of legacy <16px inputs; drop it once forms use
  // .ec-input (16px) everywhere.
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        {/* Applies the saved appearance before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="antialiased">
        <a href="#main-content" className="skip-to-content">Skip to main content</a>
        <Providers>
          <LogTradeProvider>
          {/* Desktop/laptop navigation (>= 1024px, signed in). Pages are
              offset by CSS (body.has-app-sidebar), so none need changes. */}
          <AppSidebar />
          <div id="main-content">
            {children}
          </div>
          <MobileBottomNav />
          {/* Pull down to reload on list screens (touch devices only). */}
          <PullToRefresh />
          {/* Long-press app-icon shortcuts (native only). */}
          <AppShortcuts />
          {/* Floating help. Hides itself on the admin console, the auth
              screens, onboarding and /support — see HIDDEN_PREFIXES. */}
          <SupportWidget />
          </LogTradeProvider>
        </Providers>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            // M22: Escape </script> so an injected string can't break out of the script tag
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "Edgecipline",
              url: "https://edgecipline.com",
              logo: "https://edgecipline.com/logo.png",
              sameAs: [
                "https://twitter.com/edgecipline",
              ]
            }).replace(/<\/script>/gi, "<\\/script>")
          }}
        />
      </body>
    </html>
  );
}
