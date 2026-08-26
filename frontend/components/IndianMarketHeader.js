"use client";

import { usePathname } from "next/navigation";
import PageHeader from "@/features/shared/components/PageHeader";
import { useClock } from "@/features/shared/hooks/useClock";

function IndianDashboardHeader() {
  const clock = useClock();

  return <PageHeader showMarketSwitcher showClock clock={clock} />;
}

export default function IndianMarketHeader() {
  const pathname = usePathname();

  if (pathname === "/indian-market/dashboard") {
    return <IndianDashboardHeader />;
  }

  return <PageHeader showMarketSwitcher />;
}
