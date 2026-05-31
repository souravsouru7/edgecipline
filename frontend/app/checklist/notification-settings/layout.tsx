import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Checklist Notification – Edgecipline",
  description: "Configure your pre-trade checklist notification",
};

export default function ChecklistNotificationSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
