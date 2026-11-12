import Link from "next/link";
import { Compass } from "lucide-react";

export const metadata = { title: "Page not found · Edgecipline" };

export default function NotFound() {
  return (
    <main className="ec-app" style={{ display: "grid", placeItems: "center", padding: "var(--ec-s-6)" }}>
      <div className="ec-state" style={{ maxWidth: 420 }}>
        <span className="ec-state__icon" aria-hidden="true">
          <Compass size={22} />
        </span>
        <p className="ec-num" style={{ margin: 0, fontSize: "var(--ec-fs-1)", color: "var(--ec-text-3)", letterSpacing: "0.12em" }}>
          404
        </p>
        <h1 className="ec-state__title" style={{ fontSize: "var(--ec-fs-6)" }}>
          This page doesn&apos;t exist
        </h1>
        <p className="ec-state__body">The link may be old, or the page has moved. Your journal and trades are safe.</p>
        <div className="ec-state__actions">
          <Link href="/dashboard" className="ec-btn ec-btn--primary">
            Go to dashboard
          </Link>
          <Link href="/support" className="ec-btn ec-btn--ghost">
            Get help
          </Link>
        </div>
      </div>
    </main>
  );
}
