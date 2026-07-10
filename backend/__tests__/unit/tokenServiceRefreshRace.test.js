jest.mock("../../models/RefreshToken", () => ({
  findOneAndUpdate: jest.fn(),
  findOne: jest.fn(),
  updateMany: jest.fn(),
  updateOne: jest.fn(),
  create: jest.fn(),
}));

jest.mock("../../config", () => ({
  appConfig: {
    jwt: { secret: "test-secret" },
    env: "test",
  },
}));

const RefreshToken = require("../../models/RefreshToken");
const {
  rotateRefreshToken,
  getCookieOptions,
  getClearCookieOptions,
  REFRESH_REUSE_GRACE_MS,
} = require("../../services/tokenService");

const chainPopulate = (value) => ({
  populate: jest.fn().mockResolvedValue(value),
});

describe("rotateRefreshToken race handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("recent same-client duplicate is classified as refresh race without family revocation", async () => {
    RefreshToken.findOneAndUpdate.mockReturnValueOnce(chainPopulate(null));
    RefreshToken.findOne.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue({
        userId: "user-1",
        family: "family-1",
        revokedAt: new Date(Date.now() - 100),
        deviceInfo: { userAgent: "same-agent" },
      }),
    });

    await expect(
      rotateRefreshToken("raw-token", { userAgent: "same-agent", ip: "127.0.0.1" })
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "REFRESH_TOKEN_RACE",
    });

    expect(RefreshToken.updateMany).not.toHaveBeenCalled();
  });

  test("old duplicate remains replay detection and revokes token family", async () => {
    RefreshToken.findOneAndUpdate.mockReturnValueOnce(chainPopulate(null));
    RefreshToken.findOne.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue({
        userId: "user-1",
        family: "family-1",
        revokedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1000),
        deviceInfo: { userAgent: "same-agent" },
      }),
    });
    RefreshToken.updateMany.mockResolvedValueOnce({ modifiedCount: 1 });

    await expect(
      rotateRefreshToken("raw-token", { userAgent: "same-agent", ip: "127.0.0.1" })
    ).rejects.toMatchObject({
      statusCode: 401,
      errorCode: "TOKEN_REPLAY_DETECTED",
    });

    expect(RefreshToken.updateMany).toHaveBeenCalledWith(
      { userId: "user-1", family: "family-1" },
      { $set: { revokedAt: expect.any(Date) } }
    );
  });

  test("recent reuse from a different device remains replay detection", async () => {
    RefreshToken.findOneAndUpdate.mockReturnValueOnce(chainPopulate(null));
    RefreshToken.findOne.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue({
        userId: "user-1",
        family: "family-1",
        revokedAt: new Date(Date.now() - 100),
        deviceInfo: { userAgent: "same-agent", deviceId: "device-a" },
      }),
    });
    RefreshToken.updateMany.mockResolvedValueOnce({ modifiedCount: 1 });

    await expect(
      rotateRefreshToken("raw-token", { userAgent: "same-agent", deviceId: "device-b" })
    ).rejects.toMatchObject({ errorCode: "TOKEN_REPLAY_DETECTED" });

    expect(RefreshToken.updateMany).toHaveBeenCalled();
  });

  test("replacement insert failure rolls back the claimed refresh token", async () => {
    const existing = {
      _id: "refresh-1",
      userId: { _id: "user-1", role: "user", tokenVersion: 0 },
      family: "family-1",
      expiresAt: new Date(Date.now() + 60_000),
    };
    RefreshToken.findOneAndUpdate.mockReturnValueOnce(chainPopulate(existing));
    RefreshToken.create.mockRejectedValueOnce(new Error("Mongo timeout"));
    RefreshToken.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });

    await expect(rotateRefreshToken("raw-token", { userAgent: "same-agent" }))
      .rejects.toThrow("Mongo timeout");

    expect(RefreshToken.updateOne).toHaveBeenCalledWith(
      { _id: "refresh-1", revokedAt: expect.any(Date) },
      { $set: { revokedAt: null } }
    );
  });
});

describe("refresh cookie reliability", () => {
  test("local web cookie is usable across localhost ports", () => {
    expect(getCookieOptions(false)).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/api/auth",
    });
  });

  test("Capacitor cookie enables secure cross-site refresh and clears symmetrically", () => {
    const setOptions = getCookieOptions(true);
    const clearOptions = getClearCookieOptions(true);
    expect(setOptions).toMatchObject({ secure: true, sameSite: "none", path: "/api/auth" });
    expect(clearOptions).toMatchObject({ secure: true, sameSite: "none", path: "/api/auth" });
  });
});
