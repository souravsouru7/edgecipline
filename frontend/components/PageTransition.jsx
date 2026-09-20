"use client";

import { usePathname } from "next/navigation";

// 180ms shared-axis entrance on every route change. Pure CSS keyed on the
// pathname: navigation is never delayed, no JS runs per frame, and reduced
// motion turns it off. Only the page wrapper animates — never individual
// components.
export default function PageTransition({ children }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-enter">
      {children}
    </div>
  );
}
