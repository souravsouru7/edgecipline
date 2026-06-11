const { buildCacheKey, getCache, setCache } = require("../utils/cache");
const { isRedisReady } = require("../config/redis");
const { getTradeCacheVersion } = require("../utils/cacheUtils");

function stableQuerySuffix(query = {}) {
  const keys = Object.keys(query).sort();
  if (keys.length === 0) return "default";

  return keys
    .map((key) => `${key}=${Array.isArray(query[key]) ? query[key].join(",") : query[key]}`)
    .join("&");
}

function resolveNamespace(option, req) {
  return typeof option === "function" ? option(req) : option;
}

const cacheMiddleware = (options = {}) => async (req, res, next) => {
  const normalizedOptions = typeof options === "number"
    ? { ttlSeconds: options * 60 }
    : options;

  // Bypass cache entirely if Redis is not available
  if (!isRedisReady()) {
    return next();
  }

  const ttlSeconds = normalizedOptions.ttlSeconds || 60;
  const namespace = resolveNamespace(normalizedOptions.namespace, req) || "response";
  const scope = resolveNamespace(normalizedOptions.scope, req) || req.baseUrl || req.path || "default";
  const userId = req.user?._id?.toString?.() || "anonymous";
  const version = await getTradeCacheVersion(userId);
  const querySuffix = stableQuerySuffix(req.query);
  const key = buildCacheKey(namespace, userId, `version=${version}`, scope, req.path, querySuffix);

  try {
    const cachedData = await getCache(key);
    if (cachedData !== null) {
      return res.json(cachedData);
    }

    const originalJson = res.json.bind(res);

    res.json = function cacheAwareJson(data) {
      if (res.statusCode < 400) {
        setCache(key, data, ttlSeconds).catch(() => {});
      }
      return originalJson(data);
    };

    return next();
  } catch (error) {
    return next();
  }
};

module.exports = cacheMiddleware;
