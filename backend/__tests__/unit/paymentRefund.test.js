'use strict';

jest.mock('../../models/Payment', () => ({ findOne: jest.fn() }));
jest.mock('../../models/Users', () => ({ updateOne: jest.fn() }));
jest.mock('../../models/Notification', () => ({ create: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../services/authCacheService', () => ({
  invalidateAuthCache: jest.fn().mockResolvedValue(undefined),
}));

const mongoose = require('mongoose');
const Payment = require('../../models/Payment');
const User = require('../../models/Users');
const { applyVerifiedRazorpayRefund } = require('../../services/paymentService');

const session = {
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  abortTransaction: jest.fn(),
  endSession: jest.fn(),
};

function paymentQuery(value) {
  return { session: jest.fn().mockResolvedValue(value) };
}

describe('verified Razorpay refunds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
  });

  afterAll(() => jest.restoreAllMocks());

  test('full refund is applied once and reverses revenue plus subscription duration', async () => {
    const payment = {
      _id: 'db-payment-1',
      user: 'user-1',
      amount: 150,
      status: 'completed',
      subscriptionDays: 90,
      refundedAmount: 0,
      razorpayRefundIds: [],
      save: jest.fn(),
    };
    Payment.findOne.mockReturnValue(paymentQuery(payment));
    User.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const result = await applyVerifiedRazorpayRefund({
      razorpayPaymentId: 'pay-1',
      refundKey: 'rfnd-1',
      totalRefundedAmount: 150,
      fullyRefunded: true,
    });

    expect(result.idempotent).toBe(false);
    expect(payment.status).toBe('refunded');
    expect(payment.razorpayRefundIds).toEqual(['rfnd-1']);
    expect(payment.save).toHaveBeenCalledWith({ session });
    expect(User.updateOne).toHaveBeenCalledTimes(1);
    expect(session.commitTransaction).toHaveBeenCalled();
  });

  test('replayed refund does not change revenue or subscription again', async () => {
    const payment = {
      _id: 'db-payment-1',
      user: 'user-1',
      amount: 150,
      status: 'refunded',
      subscriptionDays: 90,
      refundedAmount: 150,
      razorpayRefundIds: ['rfnd-1'],
      save: jest.fn(),
    };
    Payment.findOne.mockReturnValue(paymentQuery(payment));

    const result = await applyVerifiedRazorpayRefund({
      razorpayPaymentId: 'pay-1',
      refundKey: 'rfnd-1',
      totalRefundedAmount: 150,
      fullyRefunded: true,
    });

    expect(result.idempotent).toBe(true);
    expect(payment.save).not.toHaveBeenCalled();
    expect(User.updateOne).not.toHaveBeenCalled();
  });
});
