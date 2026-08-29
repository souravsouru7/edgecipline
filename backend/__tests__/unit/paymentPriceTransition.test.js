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
  test('an order created at the CURRENT price activates and books 537', async () => {
    setup({ orderPaise: 53700, paymentPaise: 53700 });
    const { ok, err } = await attempt();
    expect(err).toBeUndefined();
    expect(ok.amount).toBe(537);
    expect(ok.subscriptionDays).toBe(90);
  });

  test('an order created at the SUPERSEDED 150 price still activates', async () => {
    setup({ orderPaise: 15000, paymentPaise: 15000 });
    const { ok, err } = await attempt();
    expect(err).toBeUndefined();   // regression: this used to be rejected outright
    expect(ok.subscriptionDays).toBe(90);
  });

  test('a superseded-price order books what was ACTUALLY charged, not the list price', async () => {
    setup({ orderPaise: 15000, paymentPaise: 15000 });
    const { ok } = await attempt();
    expect(ok.amount).toBe(150);   // regression: this used to book 537
  });

  test('honouring a superseded price is logged for observability', async () => {
    setup({ orderPaise: 15000, paymentPaise: 15000 });
    await attempt();
    expect(logger.warn).toHaveBeenCalledWith('PAYMENT_SUPERSEDED_PRICE_HONOURED',
      expect.objectContaining({ orderAmount: 15000, currentAmount: 53700 }));
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
    setup({ orderPaise: 19900, paymentPaise: 19900, planType: '3_months' });
    const { err } = await attempt();
    expect(err.errorCode).toBe('PAYMENT_INTEGRITY_CHECK_FAILED');
  });

  test('paying LESS than the order says is rejected', async () => {
    setup({ orderPaise: 53700, paymentPaise: 15000 });
    const { err } = await attempt();
    expect(err.errorCode).toBe('PAYMENT_INTEGRITY_CHECK_FAILED');
  });

  test('paying MORE than the order says is rejected', async () => {
    setup({ orderPaise: 15000, paymentPaise: 53700 });
    const { err } = await attempt();
    expect(err.errorCode).toBe('PAYMENT_INTEGRITY_CHECK_FAILED');
  });

  test('the new 6-month tier validates and grants 180 days', async () => {
    setup({ orderPaise: 89400, paymentPaise: 89400, planType: '6_months' });
    const { ok, err } = await attempt();
    expect(err).toBeUndefined();
    expect(ok.amount).toBe(894);
    expect(ok.subscriptionDays).toBe(180);
  });

  test('the new monthly tier validates and grants 30 days', async () => {
    setup({ orderPaise: 19900, paymentPaise: 19900, planType: 'monthly' });
    const { ok, err } = await attempt();
    expect(err).toBeUndefined();
    expect(ok.amount).toBe(199);
    expect(ok.subscriptionDays).toBe(30);
  });

  test('a non-orderable plan in the order notes is still rejected', async () => {
    setup({ orderPaise: 53700, paymentPaise: 53700, planType: 'yearly' });
    const { err } = await attempt();
    expect(err.errorCode).toBe('PAYMENT_INTEGRITY_CHECK_FAILED');
  });
});
