// Drives the REAL fetchAndValidateRazorpayPayment against a stubbed Razorpay.
const USER_ID = '507f1f77bcf86cd799439011';
const ORDER_ID = 'order_test_1';
const PAYMENT_ID = 'pay_test_1';

let mockOrder, mockPayment;
jest.mock('razorpay', () => jest.fn().mockImplementation(() => ({
  orders:   { fetch: jest.fn(async () => mockOrder) },
  payments: { fetch: jest.fn(async () => mockPayment) },
})));
jest.mock('../../config', () => ({
  appConfig: { razorpay: { keyId: 'k', keySecret: 's' }, env: 'test' },
}));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const { fetchAndValidateRazorpayPayment } = require('../../services/paymentService');
const { logger } = require('../../utils/logger');

function setup({ orderPaise, paymentPaise, planType = '3_months' }) {
  mockOrder = { id: ORDER_ID, amount: orderPaise, currency: 'INR', status: 'paid',
                notes: { userId: USER_ID, planType } };
  mockPayment = { id: PAYMENT_ID, amount: paymentPaise, currency: 'INR',
                  status: 'captured', captured: true, order_id: ORDER_ID };
}
const attempt = async () => {
  try { return { ok: await fetchAndValidateRazorpayPayment({
    orderId: ORDER_ID, paymentId: PAYMENT_ID }) }; }
  catch (e) { return { err: e }; }
};

beforeEach(() => jest.clearAllMocks());

describe('price change while an order is in flight', () => {
  test('an order created at the CURRENT price activates and books 899', async () => {
    setup({ orderPaise: 89900, paymentPaise: 89900 });
    const { ok, err } = await attempt();
    expect(err).toBeUndefined();
    expect(ok.amount).toBe(899);
    expect(ok.subscriptionDays).toBe(90);
  });

  // One case per superseded price. A customer who opened checkout minutes
  // before a deploy holds a Razorpay order at the OLD amount; if validation
  // only recognised the new one they would be charged and never activated.
  test.each([
    ['150', 15000, 150],
    ['537', 53700, 537],
  ])('an order created at the SUPERSEDED %s price still activates', async (_n, paise, rupees) => {
    setup({ orderPaise: paise, paymentPaise: paise });
    const { ok, err } = await attempt();
    expect(err).toBeUndefined();   // regression: this used to be rejected outright
    expect(ok.subscriptionDays).toBe(90);
    expect(ok.amount).toBe(rupees);   // books what was ACTUALLY charged
  });

  test('honouring a superseded price is logged for observability', async () => {
    setup({ orderPaise: 53700, paymentPaise: 53700 });
    await attempt();
    expect(logger.warn).toHaveBeenCalledWith('PAYMENT_SUPERSEDED_PRICE_HONOURED',
      expect.objectContaining({ orderAmount: 53700, currentAmount: 89900 }));
  });

  test('a discounted order amount matching notes.payablePaise is accepted', async () => {
    setup({ orderPaise: 37600, paymentPaise: 37600 });
    mockOrder.notes = { userId: USER_ID, planType: '3_months', payablePaise: '37600', listAmount: '537', discountAmount: '161' };
    const { ok, err } = await attempt();
    expect(err).toBeUndefined();
    expect(ok.amount).toBe(376);
    expect(ok.promo.discountAmount).toBe(161);
  });

  test('a discounted amount that does not match notes.payablePaise is rejected', async () => {
    setup({ orderPaise: 10000, paymentPaise: 10000 });
    mockOrder.notes = { userId: USER_ID, planType: '3_months', payablePaise: '37600' };
    const { err } = await attempt();
    expect(err.errorCode).toBe('PAYMENT_INTEGRITY_CHECK_FAILED');
  });

  test('a price never charged for this plan is still rejected', async () => {
    setup({ orderPaise: 100, paymentPaise: 100 });
    const { err } = await attempt();
    expect(err.errorCode).toBe('PAYMENT_INTEGRITY_CHECK_FAILED');
  });

  test('another plan\'s price is rejected for this plan', async () => {
    // 34900 is the monthly price. priorAmounts are scoped per plan, so it is
    // not recognised for 3_months even though it is a price we really charge.
    setup({ orderPaise: 34900, paymentPaise: 34900, planType: '3_months' });
    const { err } = await attempt();
    expect(err.errorCode).toBe('PAYMENT_INTEGRITY_CHECK_FAILED');
  });

  test('a superseded price from another plan is also rejected', async () => {
    // 89400 was the old 6-month price, now in that plan's priorAmounts.
    // Leaking it across plans would sell 90 days at a 180-day price.
    setup({ orderPaise: 89400, paymentPaise: 89400, planType: '3_months' });
    const { err } = await attempt();
    expect(err.errorCode).toBe('PAYMENT_INTEGRITY_CHECK_FAILED');
  });

  test('paying LESS than the order says is rejected', async () => {
    setup({ orderPaise: 89900, paymentPaise: 15000 });
    const { err } = await attempt();
    expect(err.errorCode).toBe('PAYMENT_INTEGRITY_CHECK_FAILED');
  });

  test('paying MORE than the order says is rejected', async () => {
    setup({ orderPaise: 15000, paymentPaise: 89900 });
    const { err } = await attempt();
    expect(err.errorCode).toBe('PAYMENT_INTEGRITY_CHECK_FAILED');
  });

  test('the 6-month tier validates and grants 180 days', async () => {
    setup({ orderPaise: 149900, paymentPaise: 149900, planType: '6_months' });
    const { ok, err } = await attempt();
    expect(err).toBeUndefined();
    expect(ok.amount).toBe(1499);
    expect(ok.subscriptionDays).toBe(180);
  });

  test('the monthly tier validates and grants 30 days', async () => {
    setup({ orderPaise: 34900, paymentPaise: 34900, planType: 'monthly' });
    const { ok, err } = await attempt();
    expect(err).toBeUndefined();
    expect(ok.amount).toBe(349);
    expect(ok.subscriptionDays).toBe(30);
  });

  // The same superseded-price protection, on the other two tiers.
  test.each([
    ['monthly', 19900, 199, 30],
    ['6_months', 89400, 894, 180],
  ])('a superseded %s price still activates', async (planType, paise, rupees, days) => {
    setup({ orderPaise: paise, paymentPaise: paise, planType });
    const { ok, err } = await attempt();
    expect(err).toBeUndefined();
    expect(ok.amount).toBe(rupees);
    expect(ok.subscriptionDays).toBe(days);
  });

  test('a non-orderable plan in the order notes is still rejected', async () => {
    setup({ orderPaise: 89900, paymentPaise: 89900, planType: 'yearly' });
    const { err } = await attempt();
    expect(err.errorCode).toBe('PAYMENT_INTEGRITY_CHECK_FAILED');
  });
});
