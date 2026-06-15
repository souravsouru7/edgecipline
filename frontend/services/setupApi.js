import apiClient from "./apiClient";

export const fetchSetups = async (marketType = "Forex") => {
  const params = new URLSearchParams({ marketType });
  return await apiClient.get(`/setups?${params.toString()}`);
};

export const saveSetups = async (strategies, marketType = "Forex") => {
  const params = new URLSearchParams({ marketType });
  return await apiClient.put(`/setups?${params.toString()}`, { strategies });
};

export const uploadSetupReferenceImage = async (file) => {
  const formData = new FormData();
  formData.append("image", file);

  return await apiClient.post(`/setups/image`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const uploadSetupReferenceImages = async (files) => {
  const formData = new FormData();
  Array.from(files).forEach(file => formData.append("images", file));

  return await apiClient.post(`/setups/images`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};
