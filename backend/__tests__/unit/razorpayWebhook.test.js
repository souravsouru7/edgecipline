'use strict';

const crypto = require('crypto');

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../models/WebhookEvent', () => ({
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock('../../models/Payment', () => ({
  findOne: jest.fn(),
}));

jest.mock('../../services/paymentService', () => ({
  activateRazorpaySubscriptionPayment: jest.fn(),
  applyVerifiedRazorpayRefund: jest.fn(),
  fetchAndValidateRazorpayPayment: jest.fn(),
  getRazorpayClient: jest.fn(),
}));

const WebhookEvent = require('../../models/WebhookEvent');
const paymentService = require('../../services/paymentService');
const {
  processRazorpayWebhook,
  verifyWebhookSignature,
} = require('../../services/razorpayWebhookService');

function signedPayload(payload) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return { rawBody, signature };
}

describe('razorpayWebhookService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    WebhookEvent.findOneAndUpdate.mockReset();
    WebhookEvent.updateOne.mockReset();
    paymentService.activateRazorpaySubscriptionPayment.mockReset();
    paymentService.applyVerifiedRazorpayRefund.mockReset();
    paymentService.fetchAndValidateRazorpayPayment.mockReset();
    paymentService.getRazorpayClient.mockReset();
  });

  test('verifyWebhookSignature validates Razorpay HMAC over raw body', () => {
    const { rawBody, signature } = signedPayload({ id: 'evt_test', event: 'payment.captured' });

    expect(verifyWebhookSignature(rawBody, signature)).toBe(true);
    expect(verifyWebhookSignature(rawBody, 'deadbeef')).toBe(false);
  });

  test('payment.captured stores event and activates subscription once', async () => {
    const payload = {
      id: 'evt_pay_1',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_1',
            order_id: 'order_1',
            amount: 15000,
            currency: 'INR',
            notes: {
              userId: '507f1f77bcf86cd799439011',
              planType: '3_months',
            },
          },
        },
      },
    };
    const { rawBody, signature } = signedPayload(payload);

    WebhookEvent.findOneAndUpdate
      .mockResolvedValueOnce({ eventId: 'evt_pay_1', processed: false })
      .mockResolvedValueOnce({ eventId: 'evt_pay_1', processed: false, processing: true });
    WebhookEvent.updateOne.mockResolvedValue({ modifiedCount: 1 });
    paymentService.activateRazorpaySubscriptionPayment.mockResolvedValue({
      success: true,
      idempotent: false,
    });
    paymentService.fetchAndValidateRazorpayPayment.mockResolvedValue({
      userId: '507f1f77bcf86cd799439011',
      amount: 150,
      currency: 'INR',
      razorpayOrderId: 'order_1',
      razorpayPaymentId: 'pay_1',
      planType: '3_months',
      subscriptionDays: 90,
    });

    const result = await processRazorpayWebhook({ rawBody, signature });

    expect(result.success).toBe(true);
    expect(paymentService.activateRazorpaySubscriptionPayment).toHaveBeenCalledWith(expect.objectContaining({
      userId: '507f1f77bcf86cd799439011',
      amount: 150,
      razorpayOrderId: 'order_1',
      razorpayPaymentId: 'pay_1',
      planType: '3_months',
      source: 'razorpay_webhook',
    }));
    expect(paymentService.fetchAndValidateRazorpayPayment).toHaveBeenCalledWith({
      orderId: 'order_1',
      paymentId: 'pay_1',
    });
    expect(WebhookEvent.updateOne).toHaveBeenCalledWith(
      { eventId: 'evt_pay_1' },
      expect.objectContaining({ processed: true, processing: false })
    );
  });

  test('duplicate processed event is acknowledged without reactivation', async () => {
    const payload = {
      id: 'evt_duplicate',
      event: 'payment.captured',
      payload: {},
    };
    const { rawBody, signature } = signedPayload(payload);

    WebhookEvent.findOneAndUpdate
      .mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 11000 }))
      .mockResolvedValueOnce({ eventId: 'evt_duplicate', processed: true });

    const result = await processRazorpayWebhook({ rawBody, signature });

    expect(result.idempotent).toBe(true);
    expect(paymentService.activateRazorpaySubscriptionPayment).not.toHaveBeenCalled();
  });

  test('refund.processed re-fetches provider entities and applies a verified refund', async () => {
    const payload = {
      id: 'evt_refund_1',
      event: 'refund.processed',
      payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1' } } },
    };
    const { rawBody, signature } = signedPayload(payload);
    WebhookEvent.findOneAndUpdate
      .mockResolvedValueOnce({ eventId: 'evt_refund_1', processed: false })
      .mockResolvedValueOnce({ eventId: 'evt_refund_1', processed: false, processing: true });
    WebhookEvent.updateOne.mockResolvedValue({ modifiedCount: 1 });
    paymentService.getRazorpayClient.mockReturnValue({
      payments: { fetch: jest.fn().mockResolvedValue({
        id: 'pay_1', amount: 15000, amount_refunded: 15000, currency: 'INR', status: 'refunded',
      }) },
      refunds: { fetch: jest.fn().mockResolvedValue({
        id: 'rfnd_1', payment_id: 'pay_1', amount: 15000, status: 'processed',
      }) },
    });
    paymentService.applyVerifiedRazorpayRefund.mockResolvedValue({ success: true });

    await processRazorpayWebhook({ rawBody, signature });

    expect(paymentService.applyVerifiedRazorpayRefund).toHaveBeenCalledWith({
      razorpayPaymentId: 'pay_1',
      refundKey: 'rfnd_1',
      totalRefundedAmount: 150,
      fullyRefunded: true,
    });
  });
});
