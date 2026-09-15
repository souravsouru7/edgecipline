"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Issue reports are support tickets now — one list, one place to track them.
// This route survives only for old links (push notifications, bookmarks) and
// sends them to the unified Help & Support ticket list.
export default function MyIssuesPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/support/tickets");
  }, [router]);

  return <div style={{ minHeight: "100vh", background: "#F0EEE9" }} />;
}
