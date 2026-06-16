import apiClient from "./apiClient";
import { compressImages } from "@/utils/imageCompression";

export const ISSUE_CATEGORIES = [
  { value: "OCR_EXTRACTION", label: "OCR Extraction" },
  { value: "IMAGE_UPLOAD", label: "Image Upload" },
  { value: "TRADE_SAVE", label: "Trade Save" },
  { value: "JOURNAL", label: "Journal" },
  { value: "SETUP", label: "Setup" },
  { value: "NOTIFICATION", label: "Notification" },
  { value: "LOGIN", label: "Login" },
  { value: "PERFORMANCE", label: "Performance" },
  { value: "CRASH", label: "Crash" },
  { value: "OTHER", label: "Other" },
];

export const ISSUE_STATUSES = ["OPEN", "INVESTIGATING", "FIXED", "CLOSED"];

function detectPlatform() {
  try {
    if (typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.()) {
      const p = window.Capacitor.getPlatform?.();
      return p === "ios" ? "ios" : "android";
    }
  } catch {}
  return "web";
}

function getAppVersion() {
  try {
    return process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0";
  } catch {
    return "0.1.0";
  }
}

function buildDeviceInfo() {
  if (typeof window === "undefined") return {};
  const info = {};
  try {
    info.language = navigator.language;
    info.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    info.screen = `${window.screen?.width || 0}x${window.screen?.height || 0}`;
    info.os = navigator.userAgent?.slice(0, 120) || "";
  } catch {}
  return info;
}

/**
 * Submit an issue report. Screenshots are compressed client-side
 * (1280px / q=0.75 / JPEG) before upload to keep payload small.
 */
export const submitIssueReport = async ({
  issueCategory,
  description,
  marketType = "Unknown",
  module = "",
  screenshots = [],
  ocrDataSnapshot = null,
  tradeId = null,
  submissionId = null,
}) => {
  const fileArray = Array.from(screenshots || []).filter(Boolean);
  const compressed = fileArray.length ? await compressImages(fileArray) : [];

  const formData = new FormData();
  formData.append("issueCategory", issueCategory);
  formData.append("description", description);
  formData.append("marketType", marketType);
  if (module) formData.append("module", module);
  formData.append("platform", detectPlatform());
  formData.append("appVersion", getAppVersion());
  formData.append("deviceInfo", JSON.stringify(buildDeviceInfo()));
  if (ocrDataSnapshot) formData.append("ocrDataSnapshot", JSON.stringify(ocrDataSnapshot));
  if (tradeId) formData.append("tradeId", tradeId);
  if (submissionId) formData.append("submissionId", submissionId);
  compressed.forEach((f) => formData.append("screenshots", f));

  return await apiClient.post("/issues", formData, {
    timeout: 120000,
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const listMyIssues = async (params = {}) => {
  return await apiClient.get("/issues", { params });
};

export const getMyIssue = async (id) => {
  return await apiClient.get(`/issues/${id}`);
};

// Admin endpoints
export const adminListIssues = async (params = {}) => {
  return await apiClient.get("/admin/issues", { params });
};

export const adminGetIssue = async (id) => {
  return await apiClient.get(`/admin/issues/${id}`);
};

export const adminUpdateIssueStatus = async (id, payload) => {
  return await apiClient.patch(`/admin/issues/${id}/status`, payload);
};

export const adminGetIssueAnalytics = async () => {
  return await apiClient.get("/admin/issues/analytics/summary");
};
