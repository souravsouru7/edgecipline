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

// Remaining free-tier allowance for this market. Lets the form warn before a
// user fills it in, rather than rejecting them on submit.
export const getTradeQuota = async (marketType = 'Forex') => {
  const path = getMarketPath(marketType);
  return await apiClient.get(`${path}/trades/quota`);
};

export const getTrades = async (marketType = 'Forex', options = {}) => {
  const path = getMarketPath(marketType);
  const params = new URLSearchParams();
  if (options.period) params.set("period", options.period);
  const qs = params.toString();
  return await apiClient.get(`${path}/trades${qs ? `?${qs}` : ""}`, options.signal ? { signal: options.signal } : undefined);
};

// One page of the trade list, normalised to { items, pagination } for both
// markets so screens can append pages instead of asking for everything.
//
//   Forex  — offset paging: GET /trades?page=N&limit=50 → envelope with
//            { data, pagination: { page, total, hasNextPage } }
//   Indian — cursor paging: GET /indian/trades?cursor=&cursorId=&limit=50 →
//            { trades, nextCursor, nextCursorId, hasMore }
//
// `pagination.next` is an opaque token to pass back as `after` for the next
// page (page number for Forex, cursor pair for Indian).
export const getTradesPage = async (marketType = 'Forex', { period, after = null, limit = 50, signal } = {}) => {
  const path = getMarketPath(marketType);
  const params = new URLSearchParams();
  if (period) params.set("period", period);
  params.set("limit", String(limit));
  const opts = signal ? { signal } : {};

  if (marketType === 'Indian_Market') {
    // An (empty) cursor param opts into the cursor response shape on page 1.
    params.set("cursor", after?.cursor || "");
    if (after?.cursorId) params.set("cursorId", after.cursorId);
    const res = await apiClient.get(`${path}/trades?${params.toString()}`, opts);
    const items = Array.isArray(res) ? res : (Array.isArray(res?.trades) ? res.trades : []);
    const hasNextPage = Boolean(res?.hasMore && res?.nextCursor && res?.nextCursorId);
    return {
      items,
      pagination: {
        hasNextPage,
        next: hasNextPage ? { cursor: res.nextCursor, cursorId: String(res.nextCursorId) } : null,
        total: null,
      },
    };
  }

  const page = Number(after?.page) || 1;
  params.set("page", String(page));
  const envelope = await apiClient.get(`${path}/trades?${params.toString()}`, { rawEnvelope: true, ...opts });
  // Tolerate a bare array (older responses).
  if (Array.isArray(envelope)) return { items: envelope, pagination: { hasNextPage: false, next: null, total: envelope.length } };
  const items = Array.isArray(envelope?.data) ? envelope.data : [];
  const p = envelope?.pagination || {};
  return {
    items,
    pagination: {
      hasNextPage: Boolean(p.hasNextPage),
      next: p.hasNextPage ? { page: (Number(p.page) || page) + 1 } : null,
      total: Number.isFinite(p.total) ? p.total : items.length,
    },
  };
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
