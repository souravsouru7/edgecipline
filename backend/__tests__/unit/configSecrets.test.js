const REQUIRED_BASE_ENV = {
  NODE_ENV: "test",
  MONGO_URI: "mongodb://localhost:27017/stratedge_test",
  CLOUD_NAME: "test_cloud",
  CLOUD_API_KEY: "test_cloud_api_key",
  CLOUD_API_SECRET: "test_cloud_api_secret",
};

function loadConfigWith(env) {
  jest.resetModules();
  jest.doMock("dotenv", () => ({ config: jest.fn() }));

  const originalEnv = process.env;
  process.env = { ...REQUIRED_BASE_ENV, ...env };

  try {
    let loaded;
    jest.isolateModules(() => {
      loaded = require("../../config");
    });
    return loaded;
  } finally {
    process.env = originalEnv;
    jest.dontMock("dotenv");
  }
}

describe("JWT secret startup validation", () => {
  test("fails startup when JWT_SECRET is missing", () => {
    expect(() =>
      loadConfigWith({
        ADMIN_JWT_SECRET: "admin-secret-at-least-32-characters!!",
      })
    ).toThrow("Missing required env var: JWT_SECRET");
  });

  test("fails startup when ADMIN_JWT_SECRET is missing", () => {
    expect(() =>
      loadConfigWith({
        JWT_SECRET: "user-secret-at-least-32-characters!!!",
      })
    ).toThrow("Missing required env var: ADMIN_JWT_SECRET");
  });

  test("fails startup when admin and user JWT secrets are identical", () => {
    const shared = "shared-secret-at-least-32-characters";
    expect(() =>
      loadConfigWith({
        JWT_SECRET: shared,
        ADMIN_JWT_SECRET: shared,
      })
    ).toThrow("JWT_SECRET and ADMIN_JWT_SECRET must be different secrets");
  });

  test("loads distinct user and admin JWT secrets", () => {
    const { appConfig } = loadConfigWith({
      JWT_SECRET: "user-secret-at-least-32-characters!!!",
      ADMIN_JWT_SECRET: "admin-secret-at-least-32-characters!!",
    });

    expect(appConfig.jwt.secret).toBe("user-secret-at-least-32-characters!!!");
    expect(appConfig.jwt.adminSecret).toBe("admin-secret-at-least-32-characters!!");
  });
});
