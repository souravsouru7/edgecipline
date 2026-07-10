const express = require("express");
const request = require("supertest");
const { parseTrustProxy } = require("../../config/trustProxy");
const { requestContext } = require("../../middleware/requestContext");

function createIpApp(trustProxy) {
  const app = express();
  app.set("trust proxy", trustProxy);
  app.use(requestContext);
  app.get("/ip", (req, res) => res.json({ ip: req.ip, ips: req.ips }));
  return app;
}

describe("trust proxy configuration", () => {
  test("fails production startup when TRUST_PROXY is not explicit", () => {
    expect(() => parseTrustProxy("", { isProduction: true })).toThrow("TRUST_PROXY");
  });

  test.each(["true", "*", "0.0.0.0/0", "::/0"])("rejects unsafe trust-all value %s", (value) => {
    expect(() => parseTrustProxy(value, { isProduction: true })).toThrow(/must not trust/);
  });

  test("supports an explicit proxy CIDR list", () => {
    expect(parseTrustProxy("loopback, 10.0.0.0/8", { isProduction: true }))
      .toBe("loopback, 10.0.0.0/8");
  });

  test.each([
    ":::",
    "2001:db8:::1",
    "999.999.999.999",
    "10.0.0.1/33",
    "2001:db8::1/129",
    "10.0.0.1/not-a-prefix",
  ])("rejects malformed IP or CIDR value %s", (value) => {
    expect(() => parseTrustProxy(value, { isProduction: true }))
      .toThrow(`Invalid TRUST_PROXY entry: ${value}`);
  });

  test("ignores spoofed forwarding headers when no proxy is trusted", async () => {
    const response = await request(createIpApp(false))
      .get("/ip")
      .set("X-Forwarded-For", "198.51.100.42");

    expect(response.status).toBe(200);
    expect(response.body.ip).not.toBe("198.51.100.42");
    expect(response.body.ips).toEqual([]);
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("preserves the client IP behind one explicitly trusted proxy hop", async () => {
    const response = await request(createIpApp(1))
      .get("/ip")
      .set("X-Forwarded-For", "198.51.100.42");

    expect(response.status).toBe(200);
    expect(response.body.ip).toBe("198.51.100.42");
    expect(response.body.ips).toEqual(["198.51.100.42"]);
  });
});
