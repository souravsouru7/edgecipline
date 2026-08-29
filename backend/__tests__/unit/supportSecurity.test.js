"use strict";

/**
 * Support security boundaries, tested against the real API behaviour rather
 * than the UI.
 *
 * The five things that must never be true:
 *   1. User A can read User B's ticket, thread, or attachment.
 *   2. A customer can obtain an internal note through any route.
 *   3. A customer can pull a file off a message they cannot see.
 *   4. A revoked or suspended agent keeps working until their token expires.
 *   5. An agent can perform an action their role does not carry.
 */

const jwt = require("jsonwebtoken");

const OWNER_ID = "a".repeat(24);
const ATTACKER_ID = "b".repeat(24);
const AGENT_ID = "c".repeat(24);
const MESSAGE_ID = "d".repeat(24);

function query(result) {
  const chain = {};
  for (const method of ["select", "sort", "skip", "limit", "populate"]) {
    chain[method] = jest.fn(() => chain);
  }
  chain.lean = jest.fn().mockResolvedValue(result);
  return chain;
}

/** Runs a controller and captures what it did to the response. */
function invoke(handler, req) {
  const res = {
    statusCode: 200,
    locals: {},
    redirected: null,
    payload: null,
    status: jest.fn(function status(code) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function json(body) {
      this.payload = body;
      return this;
    }),
    redirect: jest.fn(function redirect(code, url) {
      this.redirected = { code, url };
      return this;
    }),
    setHeader: jest.fn(),
  };
  const next = jest.fn();
  return Promise.resolve(handler(req, res, next)).then(() => ({ res, next }));
}

// ─── supportAuth ─────────────────────────────────────────────────────────────

describe("supportAuth", () => {
  const SECRET = "x".repeat(40);
  let User;
  let supportAuth;
  let requireCapability;

  function token(payload) {
    return jwt.sign(payload, SECRET, { algorithm: "HS256" });
  }

  beforeEach(() => {
    jest.resetModules();
    User = { findById: jest.fn(() => query(null)) };

    jest.doMock("../../models/Users", () => User);
    jest.doMock("../../config", () => ({
      appConfig: { jwt: { adminSecret: SECRET, secret: "y".repeat(40) } },
    }));
    jest.doMock("../../middleware/adminAuth", () => ({ ADMIN_COOKIE_NAME: "admin_sid" }));

    ({ supportAuth, requireCapability } = require("../../middleware/supportAuth"));
  });

  it("rejects a request with no credentials", async () => {
    const { next } = await invoke(supportAuth, { cookies: {}, headers: {} });
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401, errorCode: "AUTH_REQUIRED" })
    );
  });

  it("rejects a token signed with the USER secret", async () => {
    // The admin workspace has its own signing secret precisely so a customer
    // access token can never reach a staff endpoint.
    const userToken = jwt.sign({ id: AGENT_ID, tokenVersion: 0 }, "y".repeat(40), { algorithm: "HS256" });
    const { next } = await invoke(supportAuth, {
      cookies: {},
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401, errorCode: "INVALID_TOKEN" })
    );
  });

  it("rejects a stale token after a logout bumped tokenVersion", async () => {
    User.findById.mockReturnValue(
      query({ _id: AGENT_ID, role: "admin", tokenVersion: 4, accountStatus: "active" })
    );
    const { next } = await invoke(supportAuth, {
      cookies: { admin_sid: token({ id: AGENT_ID, tokenVersion: 3 }) },
      headers: {},
    });
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "TOKEN_INVALIDATED" })
    );
  });

  it("rejects a suspended staff account before its token expires", async () => {
    User.findById.mockReturnValue(
      query({ _id: AGENT_ID, role: "admin", tokenVersion: 1, accountStatus: "disabled" })
    );
    const { next } = await invoke(supportAuth, {
      cookies: { admin_sid: token({ id: AGENT_ID, tokenVersion: 1 }) },
      headers: {},
    });
    // Without this, suspending an agent would not stop them reading customer
    // conversations for the rest of the token's lifetime.
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "ACCOUNT_DISABLED" })
    );
  });

  it("rejects a signed-in user who is not support staff", async () => {
    User.findById.mockReturnValue(
      query({ _id: OWNER_ID, role: "user", supportRole: null, tokenVersion: 0, accountStatus: "active" })
    );
    const { next } = await invoke(supportAuth, {
      cookies: { admin_sid: token({ id: OWNER_ID, tokenVersion: 0 }) },
      headers: {},
    });
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403, errorCode: "FORBIDDEN" })
    );
  });

  it("re-derives capabilities from the database, not from the token", async () => {
    // A token minted while the user was a lead must not still grant lead
    // powers after the role was downgraded.
    User.findById.mockReturnValue(
      query({ _id: AGENT_ID, name: "Agent", role: "user", supportRole: "agent", tokenVersion: 0, accountStatus: "active" })
    );
    const req = {
      cookies: { admin_sid: token({ id: AGENT_ID, tokenVersion: 0, supportRole: "lead" }) },
      headers: {},
    };
    const { next } = await invoke(supportAuth, req);

    expect(next).toHaveBeenCalledWith();
    expect(req.supportCapabilities).toContain("support:reply");
    expect(req.supportCapabilities).not.toContain("support:manage_kb");
    expect(req.supportCapabilities).not.toContain("support:reassign");
  });

  it("blocks an action the role does not carry", async () => {
    const guard = requireCapability("support:manage_kb");
    const next = jest.fn();
    guard({ user: { role: "user", supportRole: "agent" } }, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it("allows an action the role does carry", () => {
    const guard = requireCapability("support:reply");
    const next = jest.fn();
    guard({ user: { role: "user", supportRole: "agent" } }, {}, next);
    expect(next).toHaveBeenCalledWith();
  });
});

// ─── Attachment authorisation ────────────────────────────────────────────────

describe("attachment access", () => {
  let supportController;
  let adminSupportController;
  let messageService;
  let ticketService;

  beforeEach(() => {
    jest.resetModules();

    messageService = { getAttachmentRecord: jest.fn(), listMessagesForUser: jest.fn() };
    ticketService = { loadOwnedTicket: jest.fn() };

    jest.doMock("../../services/supportMessage.service", () => messageService);
    jest.doMock("../../services/supportTicket.service", () => ticketService);
    jest.doMock("../../services/knowledgeBase.service", () => ({}));
    jest.doMock("../../utils/supportAttachments", () => ({
      buildInlineAttachmentUrl: jest.fn(() => "https://res.cloudinary.test/signed-inline"),
      buildDownloadAttachmentUrl: jest.fn(() => "https://res.cloudinary.test/signed-download"),
      formatFromMimeType: jest.fn(() => "png"),
      destroySupportAttachments: jest.fn(),
      serializeAttachment: (a, i) => ({ index: i }),
    }));
    jest.doMock("../../utils/logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    supportController = require("../../controllers/supportController");
    adminSupportController = require("../../controllers/adminSupportController");
  });

  const publicMessage = {
    message: { _id: MESSAGE_ID, ticketUser: OWNER_ID, visibility: "public" },
    attachment: { publicId: "support-attachments/private_xyz", mimeType: "image/png" },
  };

  const internalNote = {
    message: { _id: MESSAGE_ID, ticketUser: OWNER_ID, visibility: "internal" },
    attachment: { publicId: "support-attachments/staff_only", mimeType: "image/png" },
  };

  function attachmentReq(userId, params = {}, queryParams = {}) {
    return {
      user: { _id: userId },
      requestId: "req-test",
      validated: {
        params: { messageId: MESSAGE_ID, index: 0, ...params },
        query: queryParams,
      },
    };
  }

  it("lets the owner fetch an attachment on their own public message", async () => {
    messageService.getAttachmentRecord.mockResolvedValue(publicMessage);
    const { res } = await invoke(supportController.getMyAttachment, attachmentReq(OWNER_ID));

    expect(res.redirected.code).toBe(302);
    expect(res.redirected.url).toContain("signed-inline");
  });

  it("refuses another customer's attachment with a 404, not a 403", async () => {
    messageService.getAttachmentRecord.mockResolvedValue(publicMessage);
    const { next, res } = await invoke(supportController.getMyAttachment, attachmentReq(ATTACKER_ID));

    expect(res.redirected).toBeNull();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404, errorCode: "NOT_FOUND" })
    );
  });

  it("refuses an attachment on an INTERNAL note even to the ticket owner", async () => {
    // The customer owns the ticket, but an internal note may carry a
    // screenshot an agent pasted for colleagues. Owning the ticket is not
    // permission to read a message they cannot see.
    messageService.getAttachmentRecord.mockResolvedValue(internalNote);
    const { next, res } = await invoke(supportController.getMyAttachment, attachmentReq(OWNER_ID));

    expect(res.redirected).toBeNull();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it("never returns the Cloudinary public id to the client", async () => {
    messageService.getAttachmentRecord.mockResolvedValue(publicMessage);
    const { res } = await invoke(supportController.getMyAttachment, attachmentReq(OWNER_ID));

    expect(JSON.stringify(res.redirected)).not.toContain("private_xyz");
  });

  it("lets staff fetch an attachment on an internal note", async () => {
    messageService.getAttachmentRecord.mockResolvedValue(internalNote);
    const { res } = await invoke(adminSupportController.getAttachment, attachmentReq(AGENT_ID));

    // A separate route with a separate rule, rather than one handler with a
    // branch that can be taken the wrong way.
    expect(res.redirected.code).toBe(302);
  });

  it("404s a missing attachment index rather than throwing", async () => {
    messageService.getAttachmentRecord.mockResolvedValue(null);
    const { next } = await invoke(supportController.getMyAttachment, attachmentReq(OWNER_ID, { index: 9 }));
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it("checks ticket ownership before listing a thread", async () => {
    const notFound = Object.assign(new Error("Ticket not found"), { statusCode: 404 });
    ticketService.loadOwnedTicket.mockRejectedValue(notFound);

    const { next } = await invoke(supportController.listMyTicketMessages, {
      user: { _id: ATTACKER_ID },
      validated: { params: { id: "e".repeat(24) }, query: {} },
    });

    // Without this, any authenticated user could read any thread by passing
    // someone else's ticket id straight to the message list.
    expect(messageService.listMessagesForUser).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});

// ─── Message layer ───────────────────────────────────────────────────────────

describe("message service", () => {
  let SupportMessage;
  let SupportTicket;
  let service;

  const ticket = { _id: "f".repeat(24), user: OWNER_ID, ticketCode: "EC-AAA111" };

  beforeEach(() => {
    jest.resetModules();
    // The controller block above replaced this module with a stub. resetModules
    // clears the registry but NOT the doMock registration, so without this the
    // real service is never loaded here.
    jest.dontMock("../../services/supportMessage.service");
    jest.dontMock("../../services/supportTicket.service");

    SupportMessage = {
      create: jest.fn().mockResolvedValue({ _id: MESSAGE_ID, visibility: "public" }),
      findOne: jest.fn(() => query(null)),
      findById: jest.fn(() => query(null)),
      find: jest.fn(() => query([])),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    SupportTicket = {
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };

    jest.doMock("../../models/SupportMessage", () => SupportMessage);
    jest.doMock("../../models/SupportTicket", () => SupportTicket);
    jest.doMock("../../utils/supportAttachments", () => ({
      destroySupportAttachments: jest.fn().mockResolvedValue({ destroyed: 0, failed: 0 }),
      buildInlineAttachmentUrl: jest.fn(),
      buildDownloadAttachmentUrl: jest.fn(),
      formatFromMimeType: jest.fn(),
      serializeAttachment: (a, i) => ({ index: i }),
    }));
    jest.doMock("../../utils/logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    service = require("../../services/supportMessage.service");
  });

  it("rejects a whitespace-only message", async () => {
    // "   \n\n  " passes a naive falsy check and would save a blank bubble
    // that fires a push notification saying nothing.
    for (const body of ["", "   ", "\n\n\t ", null, undefined]) {
      // eslint-disable-next-line no-await-in-loop
      await expect(
        service.appendMessage({ ticket, authorRole: "user", body })
      ).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(SupportMessage.create).not.toHaveBeenCalled();
  });

  it("rejects a message past the length ceiling", async () => {
    await expect(
      service.appendMessage({ ticket, authorRole: "user", body: "x".repeat(10001) })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("stores unicode and emoji untouched", async () => {
    await service.appendMessage({ ticket, authorRole: "user", body: "उधार वापस चाहिए 🙏 — ₹1,299" });
    expect(SupportMessage.create.mock.calls[0][0].body).toBe("उधार वापस चाहिए 🙏 — ₹1,299");
  });

  it("derives internal visibility from the type, never from the caller", async () => {
    await service.appendMessage({ ticket, authorRole: "agent", type: "internal_note", body: "check razorpay" });
    expect(SupportMessage.create.mock.calls[0][0].visibility).toBe("internal");

    SupportMessage.create.mockClear();
    await service.appendMessage({ ticket, authorRole: "agent", type: "message", body: "hello", visibility: "internal" });
    // A request body asking for a "public internal note" — or the reverse —
    // cannot influence this.
    expect(SupportMessage.create.mock.calls[0][0].visibility).toBe("public");
  });

  it("returns the original message when a timed-out reply is retried", async () => {
    const duplicate = Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    SupportMessage.create.mockRejectedValue(duplicate);
    SupportMessage.findOne.mockResolvedValue({ _id: MESSAGE_ID, body: "first attempt" });

    const result = await service.appendMessage({
      ticket,
      author: { _id: OWNER_ID, name: "Owner" },
      authorRole: "user",
      body: "retry",
      clientMessageId: "retry-key-1",
    });

    expect(result.deduped).toBe(true);
    expect(result.message.body).toBe("first attempt");
  });

  it("starts the first-response clock only on a PUBLIC agent reply", async () => {
    await service.appendMessage({ ticket, authorRole: "agent", type: "message", body: "on it" });

    const slaUpdate = SupportTicket.updateOne.mock.calls.find(
      ([filter]) => filter.firstResponseAt === null
    );
    expect(slaUpdate).toBeTruthy();
    // Idempotent under concurrency: the predicate only matches while unset.
    expect(slaUpdate[1].$set.firstResponseAt).toBeInstanceOf(Date);
  });

  it("does NOT start the first-response clock on an internal note", async () => {
    await service.appendMessage({ ticket, authorRole: "agent", type: "internal_note", body: "note" });

    // An internal note is not a response to the customer. Letting one stop the
    // clock is the most commonly fudged support metric there is.
    const slaUpdate = SupportTicket.updateOne.mock.calls.find(
      ([filter]) => filter.firstResponseAt === null
    );
    expect(slaUpdate).toBeUndefined();
  });

  it("does NOT start the first-response clock on a customer message", async () => {
    await service.appendMessage({ ticket, authorRole: "user", body: "any update?" });
    const slaUpdate = SupportTicket.updateOne.mock.calls.find(
      ([filter]) => filter.firstResponseAt === null
    );
    expect(slaUpdate).toBeUndefined();
  });

  it("advances activity timestamps with $max so a slower writer cannot rewind them", async () => {
    await service.appendMessage({ ticket, authorRole: "user", body: "hello" });

    const [, update] = SupportTicket.updateOne.mock.calls[0];
    // A customer reply and an agent reply landing microseconds apart must leave
    // the LATER timestamp behind, whichever commits second.
    expect(update.$max.lastActivityAt).toBeInstanceOf(Date);
    expect(update.$inc.messageCount).toBe(1);
    expect(update.$set).toBeUndefined();
  });

  it("filters internal notes out in the QUERY for the customer thread", async () => {
    await service.listMessagesForUser("f".repeat(24), { page: 1, limit: 30 });

    // The filter is the control. An internal note is never loaded, so no
    // downstream mistake — a response shape, a log line, an email template —
    // can leak one.
    expect(SupportMessage.find.mock.calls[0][0].visibility).toBe("public");
    expect(SupportMessage.countDocuments.mock.calls[0][0].visibility).toBe("public");
  });

  it("includes internal notes for staff", async () => {
    await service.listMessagesForStaff("f".repeat(24), { includeInternal: true });
    expect(SupportMessage.find.mock.calls[0][0].visibility).toBeUndefined();
  });

  it("clamps the thread page size regardless of what the client asks", async () => {
    await service.listMessagesForUser("f".repeat(24), { limit: 5000 });
    const chain = SupportMessage.find.mock.results[0].value;
    expect(chain.limit).toHaveBeenCalledWith(service.MAX_MESSAGE_PAGE);
  });
});
