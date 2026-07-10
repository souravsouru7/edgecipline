'use strict';

jest.mock('../../models/Payment', () => ({ findById: jest.fn() }));
jest.mock('../../models/Users', () => ({}));
jest.mock('../../services/authCacheService', () => ({ invalidateAuthCache: jest.fn() }));
jest.mock('../../services/paymentService', () => ({ getPlanConfig: jest.fn() }));

const mongoose = require('mongoose');
const Payment = require('../../models/Payment');
const { updatePaymentStatus } = require('../../admin/controllers/adminPaymentController');

const session = {
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  abortTransaction: jest.fn(),
  endSession: jest.fn(),
};

describe('admin payment status security', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
  });

  afterAll(() => jest.restoreAllMocks());

  test('admin cannot override a provider-controlled Razorpay status', async () => {
    const payment = {
      paymentMethod: 'razorpay',
      status: 'pending',
      save: jest.fn(),
    };
    Payment.findById.mockReturnValue({ session: jest.fn().mockResolvedValue(payment) });
    const next = jest.fn();

    await updatePaymentStatus(
      { body: { status: 'completed' }, params: { id: 'payment-1' } },
      { json: jest.fn() },
      next
    );

    expect(next.mock.calls[0][0].errorCode).toBe('PAYMENT_PROVIDER_STATUS_IMMUTABLE');
    expect(payment.save).not.toHaveBeenCalled();
    expect(session.abortTransaction).toHaveBeenCalled();
  });

  test('invalid status is rejected before loading a payment', async () => {
    const next = jest.fn();
    await updatePaymentStatus(
      { body: { status: 'free_forever' }, params: { id: 'payment-1' } },
      { json: jest.fn() },
      next
    );

    expect(next.mock.calls[0][0].errorCode).toBe('VALIDATION_ERROR');
    expect(Payment.findById).not.toHaveBeenCalled();
  });
});
