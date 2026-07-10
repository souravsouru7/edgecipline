"use strict";

const successResponse = (schema = { type: "object", additionalProperties: true }) => ({
  description: "Successful response",
  content: {
    "application/json": {
      schema: {
        allOf: [
          { $ref: "#/components/schemas/SuccessEnvelope" },
          { type: "object", properties: { data: schema } },
        ],
      },
    },
  },
});

const commonErrors = {
  400: { $ref: "#/components/responses/BadRequest" },
  401: { $ref: "#/components/responses/Unauthorized" },
  404: { $ref: "#/components/responses/NotFound" },
  429: { $ref: "#/components/responses/RateLimited" },
  500: { $ref: "#/components/responses/InternalError" },
};

const pathParam = {
  name: "id",
  in: "path",
  required: true,
  description: "MongoDB ObjectId",
  schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
};

const genericOperation = (method, path, tag, summary, { publicRoute = false } = {}) => ({
  tags: [tag],
  summary,
  operationId: `${method}_${path}`.replace(/[{}:/-]+/g, "_").replace(/^_|_$/g, ""),
  ...(publicRoute ? { security: [] } : {}),
  ...(path.includes("{id}") ? { parameters: [pathParam] } : {}),
  ...(["post", "put", "patch"].includes(method) ? {
    requestBody: {
      required: false,
      content: {
        "application/json": {
          schema: { type: "object", additionalProperties: true },
        },
      },
    },
  } : {}),
  responses: {
    200: successResponse(),
    ...commonErrors,
  },
});

const paths = {};
function add(method, path, tag, summary, options) {
  paths[path] ||= {};
  paths[path][method] = genericOperation(method, path, tag, summary, options);
}

const routeGroups = [
  ["Auth", "/api/auth", false, [
    ["post", "/register", "Register an account"],
    ["post", "/login", "Sign in"],
    ["post", "/google", "Sign in with Google"],
    ["post", "/forgot-password", "Request password reset"],
    ["post", "/verify-otp", "Verify password-reset OTP"],
    ["post", "/reset-password", "Reset password"],
    ["post", "/refresh", "Refresh access token"],
    ["post", "/logout", "Sign out"],
    ["post", "/logout-all", "Sign out all sessions"],
    ["post", "/accept-terms", "Accept terms and privacy policy"],
    ["get", "/me", "Get current profile"],
    ["get", "/me/preferences", "Get account preferences"],
    ["patch", "/me/preferences", "Update account preferences"],
    ["patch", "/me/onboarding", "Update onboarding progress"],
  ]],
  ["Trades", "/api/trades", false, [
    ["post", "", "Create a Forex trade"],
    ["post", "/batch", "Create Forex trades in a batch"],
    ["get", "", "List Forex trades"],
    ["get", "/status/{id}", "Get trade processing status"],
    ["get", "/{id}", "Get a Forex trade"],
    ["put", "/{id}", "Update a Forex trade"],
    ["post", "/{id}/restore", "Restore a Forex trade"],
    ["delete", "/{id}", "Delete a Forex trade"],
  ]],
  ["Setups", "/api/setups", false, [
    ["get", "", "List setups"],
    ["put", "", "Save setups"],
    ["post", "/image", "Upload one setup image"],
    ["post", "/images", "Upload setup images"],
  ]],
  ["Checklists", "/api/checklists", false, [
    ["post", "/track", "Record checklist result"],
    ["get", "/track", "Get checklist statistics"],
    ["get", "/notification-settings", "Get checklist notification settings"],
    ["put", "/notification-settings", "Update checklist notification settings"],
  ]],
  ["Dashboard", "/api/dashboard", false, [
    ["get", "/snapshot", "Get dashboard snapshot"],
  ]],
  ["Uploads", "/api/upload", false, [
    ["post", "", "Upload a trade image for extraction"],
    ["post", "/image", "Upload a screenshot"],
    ["post", "/trade-evidence", "Upload trade evidence images"],
    ["get", "/queue-health", "Get upload queue health"],
    ["get", "/job-status/{id}", "Get upload job status"],
    ["post", "/job-status/{id}/cancel", "Cancel an upload job"],
    ["post", "/cancel/{id}", "Cancel an upload job"],
  ]],
  ["Reports", "/api/reports", false, [
    ["get", "/weekly", "List weekly reports"],
    ["get", "/weekly/{id}", "Get a weekly report"],
    ["post", "/weekly/generate-now", "Generate a weekly report"],
  ]],
  ["Notifications", "/api/notifications", false, [
    ["get", "", "List notifications"],
    ["get", "/debug/setup-discipline/latest", "Get latest discipline notification diagnostic"],
    ["patch", "/read-all", "Mark all notifications read"],
    ["patch", "/{id}/read", "Mark a notification read"],
    ["post", "/{id}/opened", "Track notification open"],
    ["post", "/{id}/delivered", "Track notification delivery"],
    ["post", "/{id}/action", "Track notification action"],
  ]],
  ["Issues", "/api/issues", false, [
    ["post", "", "Submit an issue report"],
    ["get", "", "List my issue reports"],
    ["get", "/{id}", "Get my issue report"],
  ]],
  ["Feedback", "/api/feedback", false, [
    ["post", "", "Submit feedback"],
  ]],
  ["Payments", "/api/payments", false, [
    ["post", "/order", "Create a payment order"],
    ["post", "/verify", "Verify a payment"],
  ]],
  ["Payments", "/api/payments/webhook", true, [
    ["post", "", "Receive Razorpay webhook"],
  ]],
  ["Profile", "/api/profile", false, [
    ["post", "/device-tokens", "Register a push device token"],
    ["delete", "/device-tokens", "Unregister a push device token"],
    ["get", "/notification-preferences", "Get notification preferences"],
    ["patch", "/notification-preferences", "Update notification preferences"],
  ]],
  ["Indian Trades", "/api/indian/trades", false, [
    ["post", "", "Create an Indian-market trade"],
    ["post", "/batch", "Create Indian-market trades in a batch"],
    ["get", "", "List Indian-market trades"],
    ["get", "/{id}", "Get an Indian-market trade"],
    ["put", "/{id}", "Update an Indian-market trade"],
    ["post", "/{id}/restore", "Restore an Indian-market trade"],
    ["delete", "/{id}", "Delete an Indian-market trade"],
  ]],
  ["Admin Auth", "/api/admin/auth", false, [
    ["post", "/login", "Admin sign in"],
    ["post", "/logout", "Admin sign out"],
    ["post", "/logout-all", "Revoke all admin sessions"],
    ["get", "/me", "Get current admin profile"],
  ]],
  ["Admin Analytics", "/api/admin/analytics", false, [
    ["get", "/stats", "Get admin dashboard statistics"],
    ["get", "/growth", "Get growth statistics"],
  ]],
  ["Admin Users", "/api/admin/users", false, [
    ["get", "", "List users"],
    ["get", "/expired", "List expired users"],
    ["post", "/{id}/remind", "Send renewal reminder"],
    ["delete", "/{id}", "Delete a user"],
    ["patch", "/{id}/status", "Update user status"],
    ["patch", "/{id}/extend", "Extend user plan"],
  ]],
  ["Admin Payments", "/api/admin/payments", false, [
    ["get", "", "List payments"],
    ["patch", "/{id}/status", "Update payment status"],
    ["post", "/manual", "Add a manual payment"],
  ]],
  ["Admin Trades", "/api/admin/trades", false, [
    ["get", "", "List all trades"],
    ["get", "/logs", "List extraction logs"],
    ["get", "/debug", "Get trade diagnostics"],
  ]],
  ["Admin Notifications", "/api/admin/notifications", false, [
    ["get", "", "List admin notifications"],
    ["get", "/analytics", "Get notification analytics"],
    ["get", "/queue-metrics", "Get notification queue metrics"],
    ["post", "/custom", "Send a custom notification"],
    ["patch", "/{id}/read", "Mark an admin notification read"],
    ["post", "/read-all", "Mark all admin notifications read"],
  ]],
  ["Admin", "/api/admin/auth-cache-metrics", false, [
    ["get", "", "Get authentication cache metrics"],
  ]],
  ["Admin Feedback", "/api/admin/feedback", false, [
    ["get", "", "List feedback"],
    ["patch", "/{id}", "Update feedback"],
    ["delete", "/{id}", "Delete feedback"],
  ]],
  ["Admin Issues", "/api/admin/issues", false, [
    ["get", "", "List issue reports"],
    ["get", "/analytics/summary", "Get issue analytics"],
    ["get", "/{id}", "Get an issue report"],
    ["patch", "/{id}/status", "Update issue status"],
  ]],
];

for (const [tag, base, publicRoute, routes] of routeGroups) {
  for (const [method, suffix, summary] of routes) {
    add(method, `${base}${suffix}`, tag, summary, { publicRoute });
  }
}

for (const path of [
  "/api/auth/register",
  "/api/auth/login",
  "/api/auth/google",
  "/api/auth/forgot-password",
  "/api/auth/verify-otp",
  "/api/auth/reset-password",
  "/api/admin/auth/login",
]) {
  paths[path].post.security = [];
}
paths["/api/auth/refresh"].post.security = [{ refreshCookie: [] }];
paths["/api/auth/logout"].post.security = [{ refreshCookie: [] }];

for (const [path, pathItem] of Object.entries(paths)) {
  if (!path.startsWith("/api/admin/") || path === "/api/admin/auth/login") continue;
  for (const operation of Object.values(pathItem)) {
    operation.security = [{ adminSession: [] }, { bearerAuth: [] }];
  }
}

const analyticsRoutes = [
  ["snapshot", "Get canonical analytics snapshot"],
  ["summary", "Get performance summary"],
  ["weekly", "Get weekly statistics"],
  ["risk-reward", "Get risk/reward analysis"],
  ["distribution", "Get trade distribution"],
  ["performance", "Get performance metrics"],
  ["time-analysis", "Get time analysis"],
  ["quality", "Get trade quality"],
  ["drawdown", "Get drawdown analysis"],
  ["ai-insights", "Get AI insights"],
  ["advanced", "Get advanced analytics"],
  ["psychology", "Get psychology analytics"],
  ["trade-quality-analysis", "Get trade quality analysis"],
  ["self-awareness", "Get self-awareness score"],
  ["psychology-cost", "Get psychology cost"],
  ["trading-dna", "Get trading DNA"],
  ["patterns", "Get detected patterns"],
  ["ai-coach-feed", "Get AI coach feed"],
  ["psychology-timeline", "Get psychology timeline"],
  ["discipline", "Get discipline analytics"],
];
for (const [suffix, summary] of analyticsRoutes) {
  add("get", `/api/analytics/${suffix}`, "Analytics", summary);
  add("get", `/api/indian/analytics/${suffix}`, "Indian Analytics", summary);
}
add("get", "/api/indian/analytics/pnl-breakdown", "Indian Analytics", "Get P&L breakdown");

const paginationParameters = [
  {
    name: "page",
    in: "query",
    schema: { type: "integer", minimum: 1, default: 1 },
  },
  {
    name: "limit",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
  },
];
for (const path of ["/api/trades", "/api/notifications", "/api/issues", "/api/admin/issues"]) {
  paths[path].get.parameters = [
    ...(paths[path].get.parameters || []),
    ...paginationParameters,
  ];
  paths[path].get.responses[200] = {
    description: "Paginated collection",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/PaginatedEnvelope" },
        example: {
          success: true,
          data: [],
          pagination: {
            page: 1,
            limit: 50,
            total: 0,
            totalPages: 0,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        },
      },
    },
  };
}

paths["/api/trades"].post.requestBody = {
  required: true,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/TradeInput" },
      example: {
        pair: "EURUSD",
        type: "BUY",
        tradeDate: "2026-06-28T09:30:00.000Z",
        entryPrice: 1.171,
        exitPrice: 1.175,
        lotSize: 1,
      },
    },
  },
};
paths["/api/issues"].post.requestBody = {
  required: true,
  content: {
    "multipart/form-data": {
      schema: { $ref: "#/components/schemas/IssueInput" },
    },
  },
};

module.exports = {
  openapi: "3.1.0",
  info: {
    title: "StratEdge API",
    version: "1.0.0",
    description: [
      "REST API for trade journaling, analytics, notifications, issue reporting, and administration.",
      "All `/api` JSON responses use a stable `{ success, data, message?, pagination? }` envelope.",
      "Breaking changes require a new `/api/v2` route prefix; this v1 contract remains backward compatible.",
    ].join("\n\n"),
  },
  servers: [
    { url: "/", description: "Current server" },
  ],
  tags: [...new Set(routeGroups.map(([tag]) => tag).concat(["Analytics", "Indian Analytics"]))].map(
    (name) => ({ name })
  ),
  security: [{ bearerAuth: [] }],
  paths,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
      refreshCookie: {
        type: "apiKey",
        in: "cookie",
        name: "sid",
      },
      adminSession: {
        type: "apiKey",
        in: "cookie",
        name: "admin_sid",
      },
    },
    schemas: {
      SuccessEnvelope: {
        type: "object",
        required: ["success", "data"],
        properties: {
          success: { type: "boolean", const: true },
          data: {},
          message: { type: "string" },
        },
      },
      PaginatedEnvelope: {
        allOf: [
          { $ref: "#/components/schemas/SuccessEnvelope" },
          {
            type: "object",
            required: ["pagination"],
            properties: {
              data: { type: "array", items: {} },
              pagination: { $ref: "#/components/schemas/Pagination" },
            },
          },
        ],
      },
      Pagination: {
        type: "object",
        required: ["page", "limit", "total", "totalPages", "hasNextPage", "hasPreviousPage"],
        properties: {
          page: { type: "integer", minimum: 1 },
          limit: { type: "integer", minimum: 1, maximum: 100 },
          total: { type: "integer", minimum: 0 },
          totalPages: { type: "integer", minimum: 0 },
          hasNextPage: { type: "boolean" },
          hasPreviousPage: { type: "boolean" },
        },
      },
      ErrorEnvelope: {
        type: "object",
        required: ["success", "error"],
        properties: {
          success: { type: "boolean", const: false },
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string", example: "VALIDATION_ERROR" },
              message: { type: "string", example: "Request validation failed" },
              details: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    field: { type: "string", example: "body.tradeDate" },
                    code: { type: "string", example: "custom" },
                    message: { type: "string", example: "Must be a valid date" },
                  },
                },
              },
              requestId: { type: "string" },
            },
          },
        },
      },
      TradeInput: {
        type: "object",
        required: ["pair", "type", "tradeDate"],
        additionalProperties: false,
        properties: {
          pair: { type: "string", minLength: 1, maxLength: 50 },
          type: { type: "string", enum: ["BUY", "SELL"] },
          tradeDate: { type: "string", format: "date-time" },
          quantity: { type: "number" },
          lotSize: { type: "number" },
          entryPrice: { type: "number" },
          exitPrice: { type: "number" },
          stopLoss: { type: "number" },
          takeProfit: { type: "number" },
          strategy: { type: "string", maxLength: 100 },
          notes: { type: "string", maxLength: 2000 },
        },
      },
      IssueInput: {
        type: "object",
        required: ["issueCategory", "description"],
        properties: {
          issueCategory: {
            type: "string",
            enum: [
              "OCR_EXTRACTION", "IMAGE_UPLOAD", "TRADE_SAVE", "JOURNAL", "SETUP",
              "NOTIFICATION", "LOGIN", "PERFORMANCE", "CRASH", "OTHER",
            ],
          },
          description: { type: "string", minLength: 5, maxLength: 4000 },
          marketType: { type: "string", enum: ["Forex", "Indian_Market", "Both", "Unknown"] },
          module: { type: "string", maxLength: 100 },
          screenshots: {
            type: "array",
            maxItems: 8,
            items: { type: "string", format: "binary" },
          },
        },
      },
    },
    responses: Object.fromEntries([
      ["BadRequest", 400, "Invalid request"],
      ["Unauthorized", 401, "Authentication required"],
      ["NotFound", 404, "Resource not found"],
      ["RateLimited", 429, "Rate limit exceeded"],
      ["InternalError", 500, "Internal server error"],
    ].map(([name, status, description]) => [name, {
      description,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ErrorEnvelope" },
          example: {
            success: false,
            error: {
              code: status === 400 ? "VALIDATION_ERROR" : `HTTP_${status}`,
              message: description,
              requestId: "req_01J...",
            },
          },
        },
      },
    }])),
  },
};
