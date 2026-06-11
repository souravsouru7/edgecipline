jest.mock("../../models/RefreshToken", () => ({
  findOneAndUpdate: jest.fn(),
  findOne: jest.fn(),
  updateMany: jest.fn(),
  create: jest.fn(),
}));

jest.mock("../../config", () => ({
  appConfig: {
    jwt: { secret: "test-secret" },
    env: "test",
  },
}));

const RefreshToken = require("../../models/RefreshToken");
const { rotateRefreshToken, REFRESH_REUSE_GRACE_MS } = require("../../services/tokenService");

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
});
