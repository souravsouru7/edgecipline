import apiClient from "./apiClient";
import { prepareImageForUpload } from "@/utils/imageUpload";

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
