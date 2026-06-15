import apiClient from "./apiClient";
import { prepareImageForUpload } from "@/utils/imageUpload";
import { compressImages } from "@/utils/imageCompression";

export const uploadTradeImage = async ({ file, marketType, broker, tradeSubType, tradeDate }) => {
  const uploadFile = await prepareImageForUpload(file);
  const formData = new FormData();
  formData.append("image", uploadFile);
  formData.append("marketType", marketType);
  if (broker) formData.append("broker", broker);
  if (tradeSubType) formData.append("tradeSubType", tradeSubType);
  if (tradeDate) formData.append("tradeDate", tradeDate);

  return await apiClient.post(`/upload?marketType=${marketType}`, formData, { timeout: 120000 });
};

export const getUploadJobStatus = async (jobId) => {
  return await apiClient.get(`/upload/job-status/${jobId}`);
};

export const cancelUploadJob = async (jobId) => {
  return await apiClient.post(`/upload/cancel/${jobId}`);
};

export const uploadTradeScreenshot = async (file) => {
  const uploadFile = await prepareImageForUpload(file);
  const formData = new FormData();
  formData.append("image", uploadFile);

  return await apiClient.post("/upload/image", formData, { timeout: 120000 });
};

/**
 * Batch upload trade evidence images. Each file is compressed locally
 * (1280px / q=0.75 / JPEG) before upload to keep payload under ~500KB/image.
 *
 * Returns: Array of { url, publicId, thumbnailUrl, mediumUrl, size, format,
 *                     fileName, uploadedAt, order }
 *
 * Caller attaches the resulting array to trade.tradeImages on the next
 * create/update API call.
 */
export const uploadTradeEvidenceImages = async (files) => {
  const fileArray = Array.from(files || []).filter(Boolean);
  if (fileArray.length === 0) return [];

  const compressed = await compressImages(fileArray);
  const formData = new FormData();
  compressed.forEach(f => formData.append("tradeImages", f));

  return await apiClient.post("/upload/trade-evidence", formData, {
    timeout: 180000,
    headers: { "Content-Type": "multipart/form-data" },
  });
};
