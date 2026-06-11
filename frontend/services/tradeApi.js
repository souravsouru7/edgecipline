import apiClient from "./apiClient";

// Helper to get URL path prefix based on market
const getMarketPath = (marketType) => {
  if (marketType === 'Indian_Market') {
    return `/indian`;
  }
  return ``;
};

export const createTrade = async (tradeData, marketType = 'Forex') => {
  const path = getMarketPath(marketType);
  // apiClient handles the 'Authorization' header and response data returning!
  return await apiClient.post(`${path}/trades`, tradeData);
};

export const createTradesBatch = async ({ trades, ocrJobId } = {}, marketType = 'Forex') => {
  const path = getMarketPath(marketType);
  return await apiClient.post(`${path}/trades/batch`, { trades, ocrJobId });
};

export const getTrades = async (marketType = 'Forex', options = {}) => {
  const path = getMarketPath(marketType);
  const params = new URLSearchParams();
  if (options.period) params.set("period", options.period);
  const qs = params.toString();
  return await apiClient.get(`${path}/trades${qs ? `?${qs}` : ""}`);
};

export const getTrade = async (id, marketType = 'Forex') => {
  const path = getMarketPath(marketType);
  return await apiClient.get(`${path}/trades/${id}`);
};

export const getTradeStatus = async (id) => {
  return await apiClient.get(`/trade/status/${id}`);
};

export const deleteTrade = async (id, marketType = 'Forex') => {
  const path = getMarketPath(marketType);
  return await apiClient.delete(`${path}/trades/${id}`);
};

export const restoreTrade = async (id, marketType = 'Forex') => {
  const path = getMarketPath(marketType);
  return await apiClient.post(`${path}/trades/${id}/restore`);
};

export const updateTrade = async (id, tradeData, marketType = 'Forex') => {
  const path = getMarketPath(marketType);
  return await apiClient.put(`${path}/trades/${id}`, tradeData);
};
