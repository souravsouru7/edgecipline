"use strict";

/**
 * Ticket service behaviour: idempotency, abuse limits, the state machine as it
 * is actually enforced against the database, and the concurrency cases from the
 * brief (two agents assigning at once, two agents changing status at once, a
 * customer and an agent replying at the same moment).
 *
 * Models are mocked rather than run against a real MongoDB, matching the
 * convention in the rest of this suite. What is asserted is the QUERY the
 * service issues — because for every one of these cases the guard lives in the
 * update predicate, not in a JavaScript `if`.
 */

const OWNER_ID = "a".repeat(24);
const OTHER_ID = "b".repeat(24);
const AGENT_ID = "c".repeat(24);
const TICKET_ID = "d".repeat(24);

/** Chainable query stub: .select().sort().skip().limit().populate().lean() */
function query(result) {
  const chain = {};
  for (const method of ["select", "sort", "skip", "limit", "populate"]) {
    chain[method] = jest.fn(() => chain);
  }
  chain.lean = jest.fn().mockResolvedValue(result);
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function modelStub(extra = {}) {
  return {
    find: jest.fn(() => query([])),
    findOne: jest.fn(() => query(null)),
    findById: jest.fn(() => query(null)),
    findOneAndUpdate: jest.fn(() => query(null)),
    findByIdAndUpdate: jest.fn(() => query(null)),
    create: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    countDocuments: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue([]),
    ...extra,
  };
}

function ticketDoc(overrides = {}) {
  return {
    _id: TICKET_ID,
    ticketCode: "EC-TEST01",
    user: OWNER_ID,
    userEmail: "owner@example.test",
    userName: "Owner",
    subject: "Something broke",
    category: "technical_issue",
    priority: "normal",
    status: "open",
    assignedTo: null,
    tags: [],
    version: 3,
    reopenCount: 0,
    messageCount: 1,
    satisfaction: {},
    resolution: {},
    createdAt: new Date(),
    ...overrides,
  };
}

let SupportTicket;
let SupportMessage;
let SupportAuditLog;
let messageService;
let notify;
let destroySupportAttachments;
let service;

beforeEach(() => {
  jest.resetModules();

  SupportTicket = modelStub();
  SupportMessage = modelStub();
  SupportAuditLog = modelStub({ create: jest.fn().mockResolvedValue({}) });

  messageService = {
    appendMessage: jest.fn().mockResolvedValue({ message: { _id: "m1", visibility: "public" }, deduped: false }),
    recordSystemEvent: jest.fn().mockResolvedValue({}),
    normalizeBody: (raw) => {
      const trimmed = String(raw ?? "").trim();
      if (!trimmed) {
        const ApiError = require("../../utils/ApiError");
        throw new ApiError(400, "Message cannot be empty", "VALIDATION_ERROR");
      }
      return trimmed;
    },
    mapUploadsToAttachments: jest.fn((uploads = []) => uploads.map((u) => ({ publicId: u.publicId }))),
  };

  notify = {
    notifyTicketCreated: jest.fn().mockResolvedValue(),
    notifyAgentReply: jest.fn().mockResolvedValue(),
    notifyStatusChanged: jest.fn().mockResolvedValue(),
    notifyReopened: jest.fn().mockResolvedValue(),
    notifyUserReply: jest.fn().mockResolvedValue(),
    notifyAssigned: jest.fn().mockResolvedValue(),
  };

  destroySupportAttachments = jest.fn().mockResolvedValue({ destroyed: 0, failed: 0 });

  jest.doMock("../../models/SupportTicket", () => SupportTicket);
  jest.doMock("../../models/SupportMessage", () => SupportMessage);
  jest.doMock("../../models/SupportAuditLog", () => SupportAuditLog);
  jest.doMock("../../models/Users", () => modelStub());
  jest.doMock("../../models/Payment", () => modelStub());
  jest.doMock("../../models/IssueReport", () => modelStub());
  jest.doMock("../../services/supportMessage.service", () => messageService);
  jest.doMock("../../services/supportNotification.service", () => notify);
  // NOTE: no jest.requireActual() for this path inside its own factory —
  // doing so registers the real module and the mock is silently bypassed.
  jest.doMock("../../utils/supportAttachments", () => ({
    destroySupportAttachments,
    buildInlineAttachmentUrl: jest.fn(),
    buildDownloadAttachmentUrl: jest.fn(),
    formatFromMimeType: jest.fn(),
    serializeAttachment: (attachment, index) => ({
      index,
      originalName: attachment?.originalName || "",
      mimeType: attachment?.mimeType || "",
      bytes: attachment?.bytes || 0,
    }),
  }));
  jest.doMock("../../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  }));

  service = require("../../services/supportTicket.service");
});

// ─── Creation ────────────────────────────────────────────────────────────────

describe("createTicket", () => {
  const user = { _id: OWNER_ID, email: "owner@example.test", name: "Owner" };
  const body = {
    subject: "Charged twice this month",
    description: "My card was debited twice on the 3rd.",
    category: "payments",
    priority: "low",
  };

  it("creates a ticket and opens the thread with the description", async () => {
    SupportTicket.create.mockResolvedValue({
      ...ticketDoc({ category: "payments", priority: "high" }),
      toObject() {
        return ticketDoc({ category: "payments", priority: "high" });
      },
    });

    const { ticket, deduped } = await service.createTicket({ user, body, requestId: "req-1" });

    expect(deduped).toBe(false);
    // The customer asked for "low" on a payments ticket; the rule wins.
    expect(SupportTicket.create).toHaveBeenCalledWith(
      expect.objectContaining({ category: "payments", priority: "high", status: "open", user: expect.anything() })
    );
    // The description becomes message #1 so the thread reads as one
    // conversation rather than a form followed by a chat.
    expect(messageService.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ authorRole: "user", body: body.description })
    );
    expect(ticket.ticketCode).toMatch(/^EC-/);
  });

  it("ignores a client-supplied status, assignee or ticket code", async () => {
    SupportTicket.create.mockResolvedValue({ ...ticketDoc(), toObject: () => ticketDoc() });

    await service.createTicket({
      user,
      body: {
        ...body,
        status: "resolved",
        assignedTo: AGENT_ID,
        ticketCode: "EC-HACKED",
        user: OTHER_ID,
        version: 999,
      },
    });

    const created = SupportTicket.create.mock.calls[0][0];
    expect(created.status).toBe("open");
    expect(created.assignedTo).toBeUndefined();
    expect(created.ticketCode).not.toBe("EC-HACKED");
    expect(String(created.user)).toBe(OWNER_ID);
    expect(created.version).toBeUndefined();
  });

  it("returns the original ticket when a timed-out submit is retried", async () => {
    const existing = ticketDoc({ ticketCode: "EC-FIRST1" });
    SupportTicket.findOne.mockReturnValue(query(existing));

    const { ticket, deduped } = await service.createTicket({
      user,
      body: { ...body, clientRequestId: "submission-42" },
      uploadedImages: [{ publicId: "support-attachments/retry" }],
    });

    expect(deduped).toBe(true);
    expect(ticket.ticketCode).toBe("EC-FIRST1");
    expect(SupportTicket.create).not.toHaveBeenCalled();
    // The retry re-uploaded its attachments before we got here; they now point
    // at nothing, so they are cleaned up rather than orphaned on Cloudinary.
    expect(destroySupportAttachments).toHaveBeenCalled();
  });

  it("refuses a new ticket once the open-ticket cap is reached", async () => {
    SupportTicket.countDocuments.mockResolvedValue(10);

    await expect(service.createTicket({ user, body })).rejects.toMatchObject({
      statusCode: 429,
      errorCode: "SUPPORT_TOO_MANY_OPEN_TICKETS",
    });
    expect(SupportTicket.create).not.toHaveBeenCalled();
    expect(destroySupportAttachments).toHaveBeenCalled();
  });

  it("counts only UNRESOLVED tickets toward the cap", async () => {
    SupportTicket.create.mockResolvedValue({ ...ticketDoc(), toObject: () => ticketDoc() });
    await service.createTicket({ user, body });

    // A customer with twenty resolved tickets is loyal, not abusive.
    const filter = SupportTicket.countDocuments.mock.calls[0][0];
    expect(filter.status.$in).toEqual(
      expect.arrayContaining(["open", "in_progress", "waiting_on_user", "pending"])
    );
    expect(filter.status.$in).not.toContain("resolved");
    expect(filter.status.$in).not.toContain("closed");
  });

  it("rolls the ticket back if the opening message cannot be written", async () => {
    SupportTicket.create.mockResolvedValue({ ...ticketDoc(), toObject: () => ticketDoc() });
    messageService.appendMessage.mockRejectedValue(new Error("mongo down"));

    await expect(service.createTicket({ user, body })).rejects.toThrow("mongo down");

    // A ticket with no opening message is unusable; leaving it would strand
    // the customer on an empty thread.
    expect(SupportTicket.deleteOne).toHaveBeenCalledWith({ _id: TICKET_ID });
    expect(destroySupportAttachments).toHaveBeenCalled();
  });

  it("retries on a ticket-code collision instead of failing the customer", async () => {
    const duplicate = Object.assign(new Error("E11000 dup key: ticketCode"), { code: 11000 });
    SupportTicket.create
      .mockRejectedValueOnce(duplicate)
      .mockResolvedValue({ ...ticketDoc(), toObject: () => ticketDoc() });

    const { ticket } = await service.createTicket({ user, body });

    expect(SupportTicket.create).toHaveBeenCalledTimes(2);
    expect(ticket).toBeTruthy();
  });

  it("does not let a notification failure fail the ticket", async () => {
    SupportTicket.create.mockResolvedValue({ ...ticketDoc(), toObject: () => ticketDoc() });
    notify.notifyTicketCreated.mockRejectedValue(new Error("redis unavailable"));

    // The ticket is committed. Whether the push queue is healthy is not the
    // customer's problem.
    await expect(service.createTicket({ user, body })).resolves.toMatchObject({ deduped: false });
  });
});

// ─── Ownership ───────────────────────────────────────────────────────────────

describe("ownership scoping", () => {
  it("scopes the lookup by owner rather than fetching then comparing", async () => {
    SupportTicket.findOne.mockReturnValue(query(ticketDoc()));
    await service.loadOwnedTicket(OWNER_ID, TICKET_ID);

    const filter = SupportTicket.findOne.mock.calls[0][0];
    expect(filter).toHaveProperty("_id", TICKET_ID);
    expect(String(filter.user)).toBe(OWNER_ID);
  });

  it("returns 404 — not 403 — for someone else's ticket", async () => {
    SupportTicket.findOne.mockReturnValue(query(null));

    // A distinct 403 would confirm the id is real, which is exactly the signal
    // an enumeration attempt is looking for.
    await expect(service.loadOwnedTicket(OTHER_ID, TICKET_ID)).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "NOT_FOUND",
    });
  });

  it("scopes the customer's ticket list to the customer", async () => {
    await service.listUserTickets(OWNER_ID, {});
    expect(String(SupportTicket.find.mock.calls[0][0].user)).toBe(OWNER_ID);
  });

  it("clamps the page size no matter what the client asks for", async () => {
    await service.listUserTickets(OWNER_ID, { limit: 10000, page: 2 });
    const chain = SupportTicket.find.mock.results[0].value;
    expect(chain.limit).toHaveBeenCalledWith(50);
  });
});

// ─── Customer replies ────────────────────────────────────────────────────────

describe("replyAsUser", () => {
  const user = { _id: OWNER_ID, name: "Owner", email: "owner@example.test" };

  it("refuses a reply on a closed ticket", async () => {
    SupportTicket.findOne.mockReturnValue(query(ticketDoc({ status: "closed" })));

    await expect(
      service.replyAsUser({ user, ticketId: TICKET_ID, body: "hello?" })
    ).rejects.toMatchObject({ statusCode: 409, errorCode: "SUPPORT_TICKET_CLOSED" });

    expect(messageService.appendMessage).not.toHaveBeenCalled();
  });

  it("reopens a recently resolved ticket when the customer replies", async () => {
    const resolved = ticketDoc({ status: "resolved", resolvedAt: new Date() });
    SupportTicket.findOne.mockReturnValue(query(resolved));
    SupportTicket.findOneAndUpdate.mockReturnValue(query(ticketDoc({ status: "open", reopenCount: 1 })));

    const result = await service.replyAsUser({ user, ticketId: TICKET_ID, body: "still broken" });

    const [filter, update] = SupportTicket.findOneAndUpdate.mock.calls[0];
    // Guarded on the status we read: if an agent closed it in the meantime this
    // no-ops rather than dragging a closed ticket back open.
    expect(filter.status).toBe("resolved");
    // resolvedAt must be cleared or the nightly auto-close sweep would re-close
    // the ticket the customer has just brought back to life.
    expect(update.$set.resolvedAt).toBeNull();
    expect(update.$inc.reopenCount).toBe(1);
    expect(result.ticket.status).toBe("open");
    expect(notify.notifyReopened).toHaveBeenCalled();
  });

  it("refuses a reply once the reopen window has expired", async () => {
    SupportTicket.findOne.mockReturnValue(
      query(ticketDoc({ status: "resolved", resolvedAt: new Date(Date.now() - 30 * 86400000) }))
    );

    await expect(
      service.replyAsUser({ user, ticketId: TICKET_ID, body: "much later" })
    ).rejects.toMatchObject({ errorCode: "SUPPORT_REOPEN_WINDOW_EXPIRED" });
  });

  it("moves waiting_on_user to in_progress when the customer answers", async () => {
    SupportTicket.findOne.mockReturnValue(query(ticketDoc({ status: "waiting_on_user" })));
    SupportTicket.findOneAndUpdate.mockReturnValue(query(ticketDoc({ status: "in_progress" })));

    await service.replyAsUser({ user, ticketId: TICKET_ID, body: "here is the info" });

    const [filter, update] = SupportTicket.findOneAndUpdate.mock.calls[0];
    expect(filter.status).toBe("waiting_on_user");
    expect(update.$set.status).toBe("in_progress");
  });

  it("does not reopen or notify twice when a request is retried", async () => {
    SupportTicket.findOne.mockReturnValue(query(ticketDoc({ status: "resolved", resolvedAt: new Date() })));
    messageService.appendMessage.mockResolvedValue({ message: { _id: "m1" }, deduped: true });

    const result = await service.replyAsUser({
      user,
      ticketId: TICKET_ID,
      body: "duplicate",
      clientMessageId: "retry-1",
    });

    expect(result.deduped).toBe(true);
    expect(SupportTicket.findOneAndUpdate).not.toHaveBeenCalled();
    expect(notify.notifyUserReply).not.toHaveBeenCalled();
  });
});

// ─── Status transitions ──────────────────────────────────────────────────────

describe("changeStatus", () => {
  const staffUser = { _id: AGENT_ID, name: "Agent" };

  it("rejects a transition the state machine does not allow", async () => {
    SupportTicket.findById.mockReturnValue(query(ticketDoc({ status: "closed" })));

    await expect(
      service.changeStatus({ staffUser, ticketId: TICKET_ID, status: "waiting_on_user" })
    ).rejects.toMatchObject({ errorCode: "SUPPORT_INVALID_TRANSITION" });

    expect(SupportTicket.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("guards the update on the status it read, so a simultaneous change loses", async () => {
    SupportTicket.findById
      .mockReturnValueOnce(query(ticketDoc({ status: "open" })))
      .mockReturnValue(query({ status: "resolved" }));
    // Someone else already moved it — the predicate matches nothing.
    SupportTicket.findOneAndUpdate.mockReturnValue(query(null));

    await expect(
      service.changeStatus({ staffUser, ticketId: TICKET_ID, status: "closed", expectedVersion: 3 })
    ).rejects.toMatchObject({ errorCode: "SUPPORT_CONFLICT" });

    const filter = SupportTicket.findOneAndUpdate.mock.calls[0][0];
    expect(filter.status).toBe("open");
    expect(filter.version).toBe(3);
  });

  it("stamps resolution details when resolving", async () => {
    SupportTicket.findById.mockReturnValue(query(ticketDoc({ status: "in_progress" })));
    SupportTicket.findOneAndUpdate.mockReturnValue(query(ticketDoc({ status: "resolved" })));

    await service.changeStatus({
      staffUser,
      ticketId: TICKET_ID,
      status: "resolved",
      resolutionSummary: "Refund issued",
    });

    const update = SupportTicket.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set.status).toBe("resolved");
    expect(update.$set["resolution.summary"]).toBe("Refund issued");
    expect(update.$set.resolvedAt).toBeInstanceOf(Date);
    expect(notify.notifyStatusChanged).toHaveBeenCalled();
  });

  it("clears resolvedAt when a ticket is brought back to active", async () => {
    SupportTicket.findById.mockReturnValue(query(ticketDoc({ status: "resolved" })));
    SupportTicket.findOneAndUpdate.mockReturnValue(query(ticketDoc({ status: "in_progress" })));

    await service.changeStatus({ staffUser, ticketId: TICKET_ID, status: "in_progress" });

    const update = SupportTicket.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set.resolvedAt).toBeNull();
    expect(update.$set.closedAt).toBeNull();
  });

  it("treats a no-op as a no-op instead of writing", async () => {
    SupportTicket.findById.mockReturnValue(query(ticketDoc({ status: "open" })));

    const result = await service.changeStatus({ staffUser, ticketId: TICKET_ID, status: "open" });

    expect(result.changed).toBe(false);
    expect(SupportTicket.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

// ─── Assignment ──────────────────────────────────────────────────────────────

describe("assignTicket", () => {
  const agent = { _id: AGENT_ID, name: "Agent", role: "user", supportRole: "agent" };
  const lead = { _id: AGENT_ID, name: "Lead", role: "user", supportRole: "lead" };

  function mockAgentLookup(User, doc) {
    User.findById.mockReturnValue(query(doc));
  }

  it("lets exactly one of two simultaneous claims win", async () => {
    const User = require("../../models/Users");
    SupportTicket.findById
      .mockReturnValueOnce(query(ticketDoc({ assignedTo: null })))
      .mockReturnValue(query({ assignedTo: { name: "Priya" } }));
    mockAgentLookup(User, { _id: AGENT_ID, name: "Agent", role: "user", supportRole: "agent", accountStatus: "active" });
    // The other agent's update matched first, so this predicate finds nothing.
    SupportTicket.findOneAndUpdate.mockReturnValue(query(null));

    await expect(
      service.assignTicket({ staffUser: agent, ticketId: TICKET_ID, assigneeId: AGENT_ID })
    ).rejects.toMatchObject({ errorCode: "SUPPORT_CONFLICT" });

    // The claim requires assignedTo to still be null — that predicate is what
    // makes "two agents click Assign to me" resolve to one owner.
    expect(SupportTicket.findOneAndUpdate.mock.calls[0][0].assignedTo).toBeNull();
  });

  it("blocks a plain agent from taking a ticket off a colleague", async () => {
    SupportTicket.findById.mockReturnValue(query(ticketDoc({ assignedTo: OTHER_ID })));

    await expect(
      service.assignTicket({ staffUser: agent, ticketId: TICKET_ID, assigneeId: AGENT_ID })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("allows a lead to reassign", async () => {
    const User = require("../../models/Users");
    SupportTicket.findById.mockReturnValue(query(ticketDoc({ assignedTo: OTHER_ID })));
    mockAgentLookup(User, { _id: AGENT_ID, name: "Lead", role: "user", supportRole: "lead", accountStatus: "active" });
    SupportTicket.findOneAndUpdate.mockReturnValue(query(ticketDoc({ assignedTo: AGENT_ID })));

    const result = await service.assignTicket({
      staffUser: lead,
      ticketId: TICKET_ID,
      assigneeId: AGENT_ID,
      expectedVersion: 3,
    });

    expect(result.changed).toBe(true);
    expect(SupportTicket.findOneAndUpdate.mock.calls[0][0].version).toBe(3);
  });

  it("refuses to assign work to someone who is not support staff", async () => {
    const User = require("../../models/Users");
    SupportTicket.findById.mockReturnValue(query(ticketDoc({ assignedTo: null })));
    mockAgentLookup(User, { _id: OTHER_ID, name: "Customer", role: "user", supportRole: null });

    await expect(
      service.assignTicket({ staffUser: lead, ticketId: TICKET_ID, assigneeId: OTHER_ID })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("refuses to assign work to a disabled account", async () => {
    const User = require("../../models/Users");
    SupportTicket.findById.mockReturnValue(query(ticketDoc({ assignedTo: null })));
    mockAgentLookup(User, {
      _id: OTHER_ID,
      name: "Former agent",
      role: "user",
      supportRole: "agent",
      accountStatus: "disabled",
    });

    // Assigning to a suspended account means the ticket silently rots.
    await expect(
      service.assignTicket({ staffUser: lead, ticketId: TICKET_ID, assigneeId: OTHER_ID })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("records the handoff as an INTERNAL event, not a customer-visible one", async () => {
    const User = require("../../models/Users");
    SupportTicket.findById.mockReturnValue(query(ticketDoc({ assignedTo: null })));
    mockAgentLookup(User, { _id: AGENT_ID, name: "Agent", role: "user", supportRole: "agent", accountStatus: "active" });
    SupportTicket.findOneAndUpdate.mockReturnValue(query(ticketDoc({ assignedTo: AGENT_ID })));

    await service.assignTicket({ staffUser: agent, ticketId: TICKET_ID, assigneeId: AGENT_ID });

    // The customer sees that someone is on their ticket, not that it was
    // passed between three people.
    expect(messageService.recordSystemEvent).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "internal" })
    );
  });
});

// ─── Agent replies ───────────────────────────────────────────────────────────

describe("replyAsAgent", () => {
  const staffUser = { _id: AGENT_ID, name: "Agent" };

  it("does not notify the customer about an internal note", async () => {
    SupportTicket.findById.mockReturnValue(query(ticketDoc({ status: "open" })));
    messageService.appendMessage.mockResolvedValue({
      message: { _id: "note1", visibility: "internal", type: "internal_note" },
      deduped: false,
    });

    await service.replyAsAgent({ staffUser, ticketId: TICKET_ID, body: "check razorpay", internal: true });

    expect(notify.notifyAgentReply).not.toHaveBeenCalled();
    // ...and it must not move the ticket's public state either.
    expect(SupportTicket.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("derives visibility from the message type rather than the request body", async () => {
    SupportTicket.findById.mockReturnValue(query(ticketDoc()));

    await service.replyAsAgent({ staffUser, ticketId: TICKET_ID, body: "note", internal: true });

    // A crafted body cannot ask for a "public internal note".
    expect(messageService.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "internal_note" })
    );
    expect(messageService.appendMessage.mock.calls[0][0]).not.toHaveProperty("visibility");
  });

  it("moves an untouched ticket into progress on the first public reply", async () => {
    SupportTicket.findById.mockReturnValue(query(ticketDoc({ status: "open" })));
    SupportTicket.findOneAndUpdate.mockReturnValue(query(ticketDoc({ status: "in_progress" })));

    await service.replyAsAgent({ staffUser, ticketId: TICKET_ID, body: "looking into it" });

    expect(SupportTicket.findOneAndUpdate.mock.calls[0][1].$set.status).toBe("in_progress");
    expect(notify.notifyAgentReply).toHaveBeenCalled();
  });
});

// ─── Maintenance ─────────────────────────────────────────────────────────────

describe("autoCloseResolvedTickets", () => {
  it("only closes tickets still marked resolved", async () => {
    SupportTicket.find.mockReturnValue(query([{ _id: TICKET_ID, ticketCode: "EC-X", user: OWNER_ID }]));
    SupportTicket.updateMany.mockResolvedValue({ modifiedCount: 1 });

    const result = await service.autoCloseResolvedTickets({ batchSize: 100 });

    expect(result.closed).toBe(1);
    // Idempotent: a second firing of the sweep finds nothing to do.
    expect(SupportTicket.updateMany.mock.calls[0][0].status).toBe("resolved");
  });

  it("does nothing when there is nothing stale", async () => {
    SupportTicket.find.mockReturnValue(query([]));
    await expect(service.autoCloseResolvedTickets()).resolves.toEqual({ closed: 0 });
    expect(SupportTicket.updateMany).not.toHaveBeenCalled();
  });
});

// ─── Satisfaction ────────────────────────────────────────────────────────────

describe("submitSatisfaction", () => {
  const user = { _id: OWNER_ID, name: "Owner" };

  it("refuses a rating before the ticket is resolved", async () => {
    SupportTicket.findOne.mockReturnValue(query(ticketDoc({ status: "in_progress" })));

    await expect(
      service.submitSatisfaction({ user, ticketId: TICKET_ID, rating: 5 })
    ).rejects.toMatchObject({ errorCode: "SUPPORT_INVALID_STATE" });
  });

  it("is one-shot — a second submit is rejected, not silently overwritten", async () => {
    SupportTicket.findOne.mockReturnValue(query(ticketDoc({ status: "resolved" })));
    SupportTicket.findOneAndUpdate.mockReturnValue(query(null));

    await expect(
      service.submitSatisfaction({ user, ticketId: TICKET_ID, rating: 1 })
    ).rejects.toMatchObject({ errorCode: "SUPPORT_ALREADY_RATED" });

    // The `rating: null` predicate is what enforces it, under concurrency too.
    expect(SupportTicket.findOneAndUpdate.mock.calls[0][0]["satisfaction.rating"]).toBeNull();
  });

  it("scopes the update to the owner", async () => {
    SupportTicket.findOne.mockReturnValue(query(ticketDoc({ status: "resolved" })));
    SupportTicket.findOneAndUpdate.mockReturnValue(query(ticketDoc()));

    await service.submitSatisfaction({ user, ticketId: TICKET_ID, rating: 4, comment: "good" });

    expect(String(SupportTicket.findOneAndUpdate.mock.calls[0][0].user)).toBe(OWNER_ID);
  });
});
