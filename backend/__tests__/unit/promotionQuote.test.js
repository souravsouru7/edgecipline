'use strict';

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const CAMPAIGN_ID = '507f1f77bcf86cd7994390aa';
const COUPON_ID = '507f1f77bcf86cd7994390bb';

const couponDoc = {
  _id: COUPON_ID,
  codeNormalized: 'DIWALI30',
  codeDisplay: 'DIWALI30',
  campaign: CAMPAIGN_ID,
  discountType: 'percent',
  discountValue: 30,
  status: 'active',
  startsAt: null,
  expiresAt: null,
  maxRedemptions: 100,
  maxPerUser: 1,
  minAmount: 0,
  applicablePlanTypes: [],
  firstTimePayerOnly: false,
  excludeActiveSubscribers: false,
  newPurchaseOnly: false,
  redemptionCount: 2,
};

jest.mock('../../models/Coupon', () => ({
  findOne: jest.fn(),
}));
jest.mock('../../models/Campaign', () => ({
  findById: jest.fn(),
}));
jest.mock('../../models/Influencer', () => ({
  findById: jest.fn(),
}));
jest.mock('../../models/Payment', () => ({
  countDocuments: jest.fn().mockResolvedValue(0),
}));
jest.mock('../../models/CouponRedemption', () => ({
  countDocuments: jest.fn().mockResolvedValue(0),
}));

const Coupon = require('../../models/Coupon');
const Campaign = require('../../models/Campaign');
const { quoteCheckout } = require('../../services/promotionQuote.service');
const { PLAN_CONFIG } = require('../../services/paymentService');

const plan = { ...PLAN_CONFIG['3_months'], planType: '3_months', orderable: true };
const user = { _id: '507f1f77bcf86cd799439011', totalPaid: 0, subscriptionStatus: 'inactive' };

function mockHappyPath(overrides = {}) {
  Coupon.findOne.mockResolvedValue({ ...couponDoc, ...overrides });
  Campaign.findById.mockResolvedValue({
    _id: CAMPAIGN_ID,
    status: 'active',
    type: 'festival',
    startsAt: null,
    endsAt: null,
    influencer: null,
  });
}

describe('quoteCheckout', () => {
  beforeEach(() => jest.clearAllMocks());

  test('no code returns the catalogue price', async () => {
    const quote = await quoteCheckout({ user, plan, couponCode: '' });
    expect(quote.payableAmount).toBe(537);
    expect(quote.discountAmount).toBe(0);
    expect(Coupon.findOne).not.toHaveBeenCalled();
  });

  test('percent coupon quotes a discounted payable amount', async () => {
    mockHappyPath();
    const quote = await quoteCheckout({ user, plan, couponCode: ' diwali30 ' });
    expect(quote.listAmount).toBe(537);
    expect(quote.discountAmount).toBe(161);
    expect(quote.payableAmount).toBe(376);
    expect(quote.payablePaise).toBe(37600);
  });

  test('unknown codes throw a generic COUPON_INVALID', async () => {
    Coupon.findOne.mockResolvedValue(null);
    await expect(quoteCheckout({ user, plan, couponCode: 'NOPE' })).rejects.toMatchObject({
      errorCode: 'COUPON_INVALID',
      message: "This code isn't valid",
    });
  });

  test('disabled campaign is rejected generically', async () => {
    Coupon.findOne.mockResolvedValue(couponDoc);
    Campaign.findById.mockResolvedValue({ _id: CAMPAIGN_ID, status: 'paused' });
    await expect(quoteCheckout({ user, plan, couponCode: 'DIWALI30' })).rejects.toMatchObject({
      errorCode: 'COUPON_INVALID',
    });
  });

  test('max redemptions reached is rejected', async () => {
    mockHappyPath({ redemptionCount: 100, maxRedemptions: 100 });
    await expect(quoteCheckout({ user, plan, couponCode: 'DIWALI30' })).rejects.toMatchObject({
      errorCode: 'COUPON_INVALID',
    });
  });

  test('100% off is rejected so Razorpay never sees a zero order', async () => {
    mockHappyPath({ discountType: 'percent', discountValue: 100 });
    await expect(quoteCheckout({ user, plan, couponCode: 'FREE' })).rejects.toMatchObject({
      errorCode: 'COUPON_INVALID',
    });
  });
});
