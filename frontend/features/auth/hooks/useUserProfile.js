"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Sentry from "@sentry/nextjs";
import { getProfile } from "@/services/api";

const toDateString = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split("T")[0];
};

export function useUserProfile() {
  const { data } = useQuery({
    queryKey: ["userProfile"],
    queryFn: () => getProfile(),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    const userId = data?._id || data?.id;
    Sentry.setUser(userId ? { id: String(userId) } : null);
  }, [data?._id, data?.id]);

  return {
    profile: data,
    accountCreatedDate: toDateString(data?.createdAt),
  };
}
