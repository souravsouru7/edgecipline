'use strict';

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../models/Users', () => ({
  find: jest.fn(),
  updateMany: jest.fn(),
}));

jest.mock('../../services/authCacheService', () => ({
  invalidateAuthCache: jest.fn().mockResolvedValue(true),
}));

const User = require('../../models/Users');
const { invalidateAuthCache } = require('../../services/authCacheService');
const {
  expireSubscriptionBatch,
  expireSubscriptions,
} = require('../../jobs/subscriptionExpiryCron');

function mockFindUsers(users) {
  User.find.mockReturnValueOnce({
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(users),
  });
}

describe('subscriptionExpiryCron', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('expireSubscriptionBatch expires only active users past subscriptionExpiry', async () => {
    const now = new Date('2026-06-20T10:00:00.000Z');
    const users = [
      { _id: 'user_1', subscriptionExpiry: new Date('2026-06-20T09:00:00.000Z') },
      { _id: 'user_2', subscriptionExpiry: new Date('2026-06-19T09:00:00.000Z') },
    ];

    mockFindUsers(users);
    User.updateMany.mockResolvedValueOnce({ matchedCount: 2, modifiedCount: 2 });

    const result = await expireSubscriptionBatch(now, 500);

    expect(User.find).toHaveBeenCalledWith({
      subscriptionStatus: 'active',
      subscriptionExpiry: { $lt: now },
    });
    expect(User.updateMany).toHaveBeenCalledWith(
      {
        _id: { $in: ['user_1', 'user_2'] },
        subscriptionStatus: 'active',
        subscriptionExpiry: { $lt: now },
      },
      {
        $set: {
          subscriptionStatus: 'expired',
        },
      }
    );
    expect(result.modified).toBe(2);
    expect(invalidateAuthCache).toHaveBeenCalledTimes(2);
  });

  test('expireSubscriptions is safe when there are no expired active users', async () => {
    const now = new Date('2026-06-20T10:00:00.000Z');
    mockFindUsers([]);

    const result = await expireSubscriptions(now);

    expect(result.totalModified).toBe(0);
    expect(User.updateMany).not.toHaveBeenCalled();
    expect(invalidateAuthCache).not.toHaveBeenCalled();
  });
});
