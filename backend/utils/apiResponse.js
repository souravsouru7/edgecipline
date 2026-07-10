"use strict";

function success(res, data, { statusCode = 200, message, pagination } = {}) {
  const payload = {
    success: true,
    data,
    ...(message ? { message } : {}),
    ...(pagination ? { pagination } : {}),
  };

  res.locals.standardApiResponse = true;
  return res.status(statusCode).json(payload);
}

function paginated(res, data, pagination, options = {}) {
  return success(res, data, { ...options, pagination });
}

function buildPagination({ page, limit, total }) {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && totalPages > 0,
  };
}

module.exports = {
  buildPagination,
  paginated,
  success,
};
