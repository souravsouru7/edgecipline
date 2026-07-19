export const siteConfig = {
  name: "Edgecipline",
  description: "The AI Discipline Coach for retail traders — auto-logs your trades via screenshot OCR, then coaches you toward consistency with psychology analytics, missions, and streaks.",
  url: "https://edgecipline.com",
  ogImage: "/og-image.jpg",
  keywords: [
    "trading discipline app",
    "AI trading coach",
    "trading psychology analytics",
    "automated trading tracker",
    "OCR trading tool",
    "trading habit tracker",
    "stock trading analytics"
  ],
  authors: [
    {
      name: "Edgecipline",
      url: "https://edgecipline.com",
    },
  ],
  creator: "Edgecipline",
};

export const getBaseMetadata = () => {
  return {
    metadataBase: new URL(siteConfig.url),
    title: {
      default: siteConfig.name,
      template: `%s | ${siteConfig.name}`,
    },
    description: siteConfig.description,
    keywords: siteConfig.keywords,
    authors: siteConfig.authors,
    creator: siteConfig.creator,
    openGraph: {
      type: "website",
      locale: "en_US",
      url: siteConfig.url,
      title: siteConfig.name,
      description: siteConfig.description,
      siteName: siteConfig.name,
      images: [
        {
          url: siteConfig.ogImage,
          width: 1200,
          height: 630,
          alt: siteConfig.name,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: siteConfig.name,
      description: siteConfig.description,
      images: [siteConfig.ogImage],
      creator: "@edgecipline",
    },
  };
};

export const constructNoIndexMeta = (title?: string) => {
  return {
    title: title ? `${title} | ${siteConfig.name}` : siteConfig.name,
    robots: {
      index: false,
      follow: false,
      googleBot: {
        index: false,
        follow: false,
      },
    },
  };
};
