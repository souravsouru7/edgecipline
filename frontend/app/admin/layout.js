"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { clearAdminSession, getAdminProfile, hasAdminSession } from "@/services/adminApi";

/**
 * Admin Layout – Route Protection
 * Wraps all /admin/* pages (except /admin/login).
 * Verifies admin token via API call, redirects to /admin/login if unauthorized.
 */
export default function AdminLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isVerified, setIsVerified] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Skip auth check for the login page
    if (pathname === "/admin/login") {
      setIsLoading(false);
      setIsVerified(true);
      return;
    }

    const verifyAdmin = async () => {
      if (!hasAdminSession()) {
        router.replace("/admin/login");
        setIsLoading(false);
        return;
      }

      try {
        const profile = await getAdminProfile();
        if (profile && profile.role === "admin") {
          setIsVerified(true);
        } else {
          router.replace("/admin/login");
        }
      } catch {
        // Cookie missing, expired, or user is not admin
        router.replace("/admin/login");
      } finally {
        setIsLoading(false);
      }
    };

    verifyAdmin();
  }, [pathname, router]);

  // Loading state
  if (isLoading) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "#F0EEE9",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'JetBrains Mono',monospace",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 40, height: 40, border: "3px solid #E2E8F0",
            borderTop: "3px solid #B8860B", borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
            margin: "0 auto 16px",
          }} />
          <div style={{ fontSize: 12, color: "#94A3B8", letterSpacing: "0.1em" }}>
            VERIFYING ADMIN ACCESS...
          </div>
        </div>
        <style>{`
          @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        `}</style>
      </div>
    );
  }

  if (!isVerified) return null;

  return <>{children}</>;
}
