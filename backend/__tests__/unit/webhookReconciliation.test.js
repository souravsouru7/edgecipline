'use strict';

/**
 * Webhook reconciliation and retention.
 *
 * Covers Phases 24 and 25 of the payment QA plan.
 *
 * Reconciliation is the last line of defence for money already taken: if
 * webhook processing kept throwing until Razorpay stopped retrying, this job
 * is the only thing that still activates the subscription. Its two hard
 * requirements are that it reuses the real activation path (never a second
 * implementation) and that a retry can never double-activate.
 */

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../models/WebhookEvent', () => ({
  find: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
  updateMany: jest.fn(),
}));

jest.mock('../../services/paymentService', () => ({
  activateRazorpaySubscriptionPayment: jest.fn(),
  applyVerifiedRazorpayRefund: jest.fn(),
  fetchAndValidateRazorpayPayment: jest.fn(),
  getRazorpayClient: jest.fn(),
}));

jest.mock('../../services/analyticsEventService', () => ({ track: jest.fn() }));

jest.mock('../../config/sentry', () => ({
  captureOperationalError: jest.fn(),
}));

jest.mock('../../utils/distributedLock', () => ({
  withCronLock: jest.fn(async (_opts, fn) => ({ acquired: true, skipped: false, result: await fn() })),
}));

jest.mock('../../utils/cronMetrics', () => ({
  recordCronRun: jest.fn((name, record) => ({ name, ...record })),
}));

const WebhookEvent = require('../../models/WebhookEvent');
const paymentService = require('../../services/paymentService');
const { captureOperationalError } = require('../../config/sentry');
const {
  MAX_PROCESSING_ATTEMPTS,
  reprocessStoredWebhookEvent,
} = require('../../services/razorpayWebhookService');
const {
  MIN_EVENT_AGE_MS,
  reconcileWebhookEvents,
} = require('../../jobs/webhookReconciliationCron');
const { pruneProcessedPayloads, PRUNED_PAYLOAD } = require('../../jobs/webhookRetentionCron');

const CAPTURED_PAYLOAD = {
  id: 'evt_recon_1',
  event: 'payment.captured',
  payload: { payment: { entity: { id: 'pay_recon_1', order_id: 'order_recon_1' } } },
};

function storedEvent(overrides = {}) {
  return {
    eventId: 'evt_recon_1',
    eventType: 'payment.captured',
    processed: false,
    processing: false,
    processingAttempts: 1,
    payload: CAPTURED_PAYLOAD,
    ...overrides,
  };
}

/** Chainable WebhookEvent.find(...).select().sort().limit().lean() */
function findChain(value) {
  const chain = {
    select: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    lean: jest.fn(async () => value),
  };
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
  WebhookEvent.updateOne.mockResolvedValue({ modifiedCount: 1 });
  WebhookEvent.updateMany.mockResolvedValue({ modifiedCount: 0 });
  paymentService.fetchAndValidateRazorpayPayment.mockResolvedValue({
    userId: '507f1f77bcf86cd799439011',
    amount: 150,
    currency: 'INR',
    razorpayOrderId: 'order_recon_1',
    razorpayPaymentId: 'pay_recon_1',
    planType: '3_months',
    subscriptionDays: 90,
  });
  paymentService.activateRazorpaySubscriptionPayment.mockResolvedValue({
    success: true,
    idempotent: false,
  });
});

// ---------------------------------------------------------------------------
// Phase 24 — reprocessing a stored event
// ---------------------------------------------------------------------------

describe('Phase 24 — reprocessStoredWebhookEvent', () => {
  test('replays a stalled event through the real activation path', async () => {
    WebhookEvent.findOneAndUpdate.mockResolvedValue(storedEvent());

    const result = await reprocessStoredWebhookEvent('evt_recon_1');

    expect(result.recovered).toBe(true);
    // The guarantee that matters: reconciliation does not own a second
    // activation implementation, it drives the production one.
    expect(paymentService.activateRazorpaySubscriptionPayment).toHaveBeenCalledWith(
      expect.objectContaining({ razorpayPaymentId: 'pay_recon_1', source: 'razorpay_webhook' })
    );
    expect(WebhookEvent.updateOne).toHaveBeenCalledWith(
      { eventId: 'evt_recon_1' },
      expect.objectContaining({ processed: true, processing: false })
    );
  });

  test('claims the event atomically before doing any work', async () => {
    WebhookEvent.findOneAndUpdate.mockResolvedValue(storedEvent());

    await reprocessStoredWebhookEvent('evt_recon_1');

    const [filter, update] = WebhookEvent.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual(
      expect.objectContaining({
        eventId: 'evt_recon_1',
        processed: false,
        permanentlyFailed: { $ne: true },
        processingAttempts: { $lt: MAX_PROCESSING_ATTEMPTS },
      })
    );
    expect(update.$set.processing).toBe(true);
    expect(update.$inc).toEqual({ processingAttempts: 1 });
  });

  test('returns null without processing when the event cannot be claimed', async () => {
    // Another worker or a live delivery already holds it.
    WebhookEvent.findOneAndUpdate.mockResolvedValue(null);

    const result = await reprocessStoredWebhookEvent('evt_recon_1');

    expect(result).toBeNull();
    expect(paymentService.activateRazorpaySubscriptionPayment).not.toHaveBeenCalled();
  });

  test('does not re-verify the signature — provenance was established at ingest', async () => {
    WebhookEvent.findOneAndUpdate.mockResolvedValue(storedEvent());

    // No signature is available at reconciliation time; the call must still work.
    const result = await reprocessStoredWebhookEvent('evt_recon_1');

    expect(result.recovered).toBe(true);
  });

  test('records the error and stays retryable when an attempt fails below the cap', async () => {
    WebhookEvent.findOneAndUpdate.mockResolvedValue(storedEvent({ processingAttempts: 2 }));
    paymentService.fetchAndValidateRazorpayPayment.mockRejectedValueOnce(new Error('razorpay 503'));

    const result = await reprocessStoredWebhookEvent('evt_recon_1');

    expect(result.recovered).toBe(false);
    expect(result.exhausted).toBe(false);
    const update = WebhookEvent.updateOne.mock.calls[0][1];
    expect(update.processing).toBe(false);
    expect(update.processingError).toContain('razorpay 503');
    expect(update.permanentlyFailed).toBeUndefined();
  });

  test('marks the event permanently failed once the attempt cap is reached', async () => {
    WebhookEvent.findOneAndUpdate.mockResolvedValue(
      storedEvent({ processingAttempts: MAX_PROCESSING_ATTEMPTS })
    );
    paymentService.fetchAndValidateRazorpayPayment.mockRejectedValueOnce(new Error('still broken'));

    const result = await reprocessStoredWebhookEvent('evt_recon_1');

    expect(result.exhausted).toBe(true);
    const update = WebhookEvent.updateOne.mock.calls[0][1];
    expect(update.permanentlyFailed).toBe(true);
    expect(update.permanentlyFailedAt).toBeInstanceOf(Date);
  });

  test('a recovered event is idempotent — activation reports no double charge', async () => {
    WebhookEvent.findOneAndUpdate.mockResolvedValue(storedEvent());
    paymentService.activateRazorpaySubscriptionPayment.mockResolvedValue({
      success: true,
      idempotent: true,
    });

    const result = await reprocessStoredWebhookEvent('evt_recon_1');

    expect(result.recovered).toBe(true);
    expect(result.result.idempotent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 24 — the sweep
// ---------------------------------------------------------------------------

describe('Phase 24 — reconcileWebhookEvents sweep', () => {
  test('only reaches for events old enough that Razorpay has stopped retrying', async () => {
    WebhookEvent.find.mockReturnValue(findChain([]));
    const now = new Date();

    await reconcileWebhookEvents(now);

    const filter = WebhookEvent.find.mock.calls[0][0];
    expect(filter.processed).toBe(false);
    expect(filter.permanentlyFailed).toEqual({ $ne: true });
    expect(filter.processingAttempts).toEqual({ $lt: MAX_PROCESSING_ATTEMPTS });
    expect(filter.createdAt.$lt.getTime()).toBe(now.getTime() - MIN_EVENT_AGE_MS);
  });

  test('counts recoveries and leaves untouched events alone', async () => {
    WebhookEvent.find.mockReturnValue(
      findChain([{ eventId: 'evt_a' }, { eventId: 'evt_b' }, { eventId: 'evt_c' }])
    );
    WebhookEvent.findOneAndUpdate
      .mockResolvedValueOnce(storedEvent({ eventId: 'evt_a' }))
      .mockResolvedValueOnce(null) // claimed elsewhere
      .mockResolvedValueOnce(storedEvent({ eventId: 'evt_c' }));

    const result = await reconcileWebhookEvents(new Date());

    expect(result).toEqual(
      expect.objectContaining({ scanned: 3, recovered: 2, skipped: 1, exhausted: 0 })
    );
  });

  test('raises a Sentry alert when an event is permanently lost', async () => {
    WebhookEvent.find.mockReturnValue(findChain([{ eventId: 'evt_doomed' }]));
    WebhookEvent.findOneAndUpdate.mockResolvedValue(
      storedEvent({ eventId: 'evt_doomed', processingAttempts: MAX_PROCESSING_ATTEMPTS })
    );
    paymentService.fetchAndValidateRazorpayPayment.mockRejectedValue(new Error('gone'));

    const result = await reconcileWebhookEvents(new Date());

    expect(result.exhausted).toBe(1);
    expect(captureOperationalError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ subsystem: 'razorpay' })
    );
  });

  test('an empty sweep is a no-op', async () => {
    WebhookEvent.find.mockReturnValue(findChain([]));

    const result = await reconcileWebhookEvents(new Date());

    expect(result.scanned).toBe(0);
    expect(WebhookEvent.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 25 — retention
// ---------------------------------------------------------------------------

describe('Phase 25 — webhook payload retention', () => {
  test('prunes only processed, non-failed, unpruned events past the window', async () => {
    WebhookEvent.find.mockReturnValue(findChain([]));
    const now = new Date();

    await pruneProcessedPayloads(now, 500);

    const filter = WebhookEvent.find.mock.calls[0][0];
    expect(filter.processed).toBe(true);
    expect(filter.permanentlyFailed).toEqual({ $ne: true });
    expect(filter.payloadPrunedAt).toEqual({ $exists: false });
    // 90-day default window.
    const expectedCutoff = now.getTime() - 90 * 24 * 60 * 60 * 1000;
    expect(filter.processedAt.$lt.getTime()).toBe(expectedCutoff);
  });

  test('replaces the payload with a tombstone rather than deleting the document', async () => {
    WebhookEvent.find.mockReturnValue(findChain([{ _id: 'a' }, { _id: 'b' }]));
    WebhookEvent.updateMany.mockResolvedValue({ modifiedCount: 2 });

    const result = await pruneProcessedPayloads(new Date(), 500);

    expect(result.pruned).toBe(2);
    const [filter, update] = WebhookEvent.updateMany.mock.calls[0];
    expect(filter).toEqual({ _id: { $in: ['a', 'b'] } });
    expect(update.$set.payload).toEqual(PRUNED_PAYLOAD);
    expect(update.$set.payloadPrunedAt).toBeInstanceOf(Date);
  });

  test('never deletes events — eventId idempotency must survive retention', async () => {
    WebhookEvent.find.mockReturnValue(findChain([{ _id: 'a' }]));

    await pruneProcessedPayloads(new Date(), 500);

    expect(WebhookEvent.deleteMany).toBeUndefined();
    expect(WebhookEvent.updateMany).toHaveBeenCalled();
  });

  test('does not prune unprocessed events — reconciliation still needs their payload', async () => {
    WebhookEvent.find.mockReturnValue(findChain([]));

    await pruneProcessedPayloads(new Date(), 500);

    expect(WebhookEvent.find.mock.calls[0][0].processed).toBe(true);
  });

  test('an empty window is a no-op', async () => {
    WebhookEvent.find.mockReturnValue(findChain([]));

    const result = await pruneProcessedPayloads(new Date(), 500);

    expect(result).toEqual(expect.objectContaining({ matched: 0, pruned: 0 }));
    expect(WebhookEvent.updateMany).not.toHaveBeenCalled();
  });
});
