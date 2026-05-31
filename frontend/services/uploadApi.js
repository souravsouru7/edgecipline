import apiClient from "./apiClient";

export const uploadTradeImage = async ({ file, marketType, broker, tradeSubType, tradeDate }) => {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("marketType", marketType);
  if (broker) formData.append("broker", broker);
  if (tradeSubType) formData.append("tradeSubType", tradeSubType);
  if (tradeDate) formData.append("tradeDate", tradeDate);

  return await apiClient.post(`/upload?marketType=${marketType}`, formData, { timeout: 120000 });
};

export const uploadTradeScreenshot = async (file) => {
  const formData = new FormData();
  formData.append("image", file);

  return await apiClient.post("/upload/image", formData, { timeout: 120000 });
};
