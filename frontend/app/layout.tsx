import type { Metadata } from "next";
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
      { url: "/logo.png", type: "image/png" },
    ],
    shortcut: "/logo.png",
    apple: "/logo.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Edgecipline",
    startupImage: "/logo.png",
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <Providers>
          {children}
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
