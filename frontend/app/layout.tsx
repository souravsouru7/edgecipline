import type { Metadata } from "next";
import "./fonts.css";
import "./globals.css";
import "./mobile-optimizations.css";
import Providers from "./providers";
import MobileBottomNav from "@/features/shared/components/MobileBottomNav";

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
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <head>
      </head>
      <body className="antialiased">
        <a href="#main-content" className="skip-to-content">Skip to main content</a>
        <Providers>
          <div id="main-content">
            {children}
          </div>
          <MobileBottomNav />
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
