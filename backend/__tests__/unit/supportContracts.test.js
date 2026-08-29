"use strict";

/**
 * The support rules that are cheap to state and expensive to get wrong.
 *
 * Everything here is pure logic — no database, no mocks. These are the
 * invariants that the rest of the system leans on: the ticket state machine,
 * who may do what, and the hard guarantee that a customer-facing payload can
 * never contain staff-only data.
 */

const {
  canTransition,
  normalizeUserPriority,
  resolveCapabilities,
  hasCapability,
  isSupportStaff,
  TICKET_STATUSES,
  STATUS_TRANSITIONS,
  USER_SELECTABLE_PRIORITIES,
  SUPPORT_CAPABILITIES,
  SUPPORT_CATEGORY_VALUES,
} = require("../../constants/support");

const {
  serializeTicketForUser,
  serializeTicketForStaff,
  serializeMessageForUser,
  serializeMessageForStaff,
  canUserReopen,
} = require("../../utils/supportSerializers");

const AGENT_ID = "b".repeat(24);
const OWNER_ID = "a".repeat(24);

function buildTicket(overrides = {}) {
  return {
    _id: "1".repeat(24),
    ticketCode: "EC-AB12CD",
    user: OWNER_ID,
    userEmail: "customer@example.test",
    userName: "Customer",
    subject: "Charged twice",
    category: "payments",
    priority: "high",
    status: "open",
    assignedTo: AGENT_ID,
    tags: ["duplicate_charge", "vip"],
    channel: "portal",
    messageCount: 3,
    version: 7,
    reopenCount: 1,
    source: { platform: "android", appVersion: "1.2.3", marketType: "Indian_Market" },
    resolution: { summary: "Refunded", resolvedBy: AGENT_ID },
    satisfaction: {},
    createdAt: new Date("2026-08-01T10:00:00Z"),
    lastActivityAt: new Date("2026-08-02T10:00:00Z"),
    firstResponseAt: new Date("2026-08-01T12:00:00Z"),
    ...overrides,
  };
}

describe("ticket state machine", () => {
  it("only allows transitions declared in the table", () => {
    for (const from of TICKET_STATUSES) {
      for (const to of TICKET_STATUSES) {
        const declared = STATUS_TRANSITIONS[from]?.includes(to) && from !== to;
        expect(canTransition(from, to, { actorRole: "agent" })).toBe(Boolean(declared));
      }
    }
  });

  it("refuses a transition to a status that does not exist", () => {
    expect(canTransition("open", "deleted")).toBe(false);
    expect(canTransition("open", "")).toBe(false);
    expect(canTransition("open", undefined)).toBe(false);
  });

  it("treats a no-op transition as invalid so callers do not double-write", () => {
    for (const status of TICKET_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it("lets a customer reopen a resolved ticket", () => {
    expect(canTransition("resolved", "open", { actorRole: "user" })).toBe(true);
  });

  it("never lets a customer revive a CLOSED ticket", () => {
    // The brief's example: a closed ticket must not silently become active
    // because of an accidental — or forged — API call.
    expect(canTransition("closed", "open", { actorRole: "user" })).toBe(false);
    expect(canTransition("closed", "in_progress", { actorRole: "user" })).toBe(false);
    // Staff may still reopen deliberately.
    expect(canTransition("closed", "open", { actorRole: "agent" })).toBe(true);
  });
});

describe("priority normalisation", () => {
  it("never lets a customer self-declare urgent", () => {
    expect(USER_SELECTABLE_PRIORITIES).not.toContain("urgent");
    expect(normalizeUserPriority("urgent", "other")).toBe("normal");
  });

  it("falls back to normal for anything unrecognised", () => {
    for (const value of [undefined, null, "", "critical", "P0", 9, {}]) {
      expect(normalizeUserPriority(value, "other")).toBe("normal");
    }
  });

  it("keeps a legitimate customer choice", () => {
    expect(normalizeUserPriority("low", "other")).toBe("low");
    expect(normalizeUserPriority("high", "other")).toBe("high");
  });

  it("floors money-related categories at high", () => {
    // A stuck payment is time-critical whatever the customer ticked.
    expect(normalizeUserPriority("low", "payments")).toBe("high");
    expect(normalizeUserPriority("normal", "subscription_billing")).toBe("high");
  });

  it("does not raise priority for non-money categories", () => {
    expect(normalizeUserPriority("low", "feature_request")).toBe("low");
  });
});

describe("capabilities", () => {
  const admin = { role: "admin" };
  const lead = { role: "user", supportRole: "lead" };
  const agent = { role: "user", supportRole: "agent" };
  const customer = { role: "user", supportRole: null };

  it("recognises staff and only staff", () => {
    expect(isSupportStaff(admin)).toBe(true);
    expect(isSupportStaff(lead)).toBe(true);
    expect(isSupportStaff(agent)).toBe(true);
    expect(isSupportStaff(customer)).toBe(false);
    expect(isSupportStaff(null)).toBe(false);
    // A forged supportRole value must not grant anything.
    expect(isSupportStaff({ role: "user", supportRole: "superadmin" })).toBe(false);
  });

  it("gives a plain customer nothing", () => {
    expect(resolveCapabilities(customer)).toEqual([]);
    expect(resolveCapabilities(undefined)).toEqual([]);
  });

  it("withholds reassignment, billing and KB editing from a plain agent", () => {
    expect(hasCapability(agent, SUPPORT_CAPABILITIES.REPLY)).toBe(true);
    expect(hasCapability(agent, SUPPORT_CAPABILITIES.ASSIGN_SELF)).toBe(true);
    expect(hasCapability(agent, SUPPORT_CAPABILITIES.REASSIGN)).toBe(false);
    expect(hasCapability(agent, SUPPORT_CAPABILITIES.VIEW_BILLING)).toBe(false);
    expect(hasCapability(agent, SUPPORT_CAPABILITIES.MANAGE_KB)).toBe(false);
    expect(hasCapability(agent, SUPPORT_CAPABILITIES.MANAGE_AGENTS)).toBe(false);
  });

  it("gives a lead reassignment, billing and KB but not agent administration", () => {
    expect(hasCapability(lead, SUPPORT_CAPABILITIES.REASSIGN)).toBe(true);
    expect(hasCapability(lead, SUPPORT_CAPABILITIES.VIEW_BILLING)).toBe(true);
    expect(hasCapability(lead, SUPPORT_CAPABILITIES.MANAGE_KB)).toBe(true);
    expect(hasCapability(lead, SUPPORT_CAPABILITIES.MANAGE_AGENTS)).toBe(false);
    expect(hasCapability(lead, SUPPORT_CAPABILITIES.DELETE_TICKET)).toBe(false);
  });

  it("gives an admin everything", () => {
    for (const capability of Object.values(SUPPORT_CAPABILITIES)) {
      expect(hasCapability(admin, capability)).toBe(true);
    }
  });
});

describe("customer-facing serialisation never leaks staff data", () => {
  it("omits the assignee, tags, internal metadata and version from a ticket", () => {
    const payload = serializeTicketForUser(buildTicket());
    const serialised = JSON.stringify(payload);

    // The customer learns THAT someone is handling it, never who.
    expect(payload.isAssigned).toBe(true);
    expect(serialised).not.toContain(AGENT_ID);

    for (const field of ["assignedTo", "assignee", "tags", "version", "source", "firstResponseAt", "userEmail"]) {
      expect(payload).not.toHaveProperty(field);
    }
    expect(serialised).not.toContain("duplicate_charge");
    expect(serialised).not.toContain("vip");
  });

  it("gives staff the queue metadata the customer does not get", () => {
    const payload = serializeTicketForStaff(buildTicket());
    expect(payload.tags).toEqual(["duplicate_charge", "vip"]);
    expect(payload.version).toBe(7);
    expect(payload.assignee.id).toBe(AGENT_ID);
    expect(payload.firstResponseAt).toBeTruthy();
  });

  it("refuses to serialise an internal note for a customer", () => {
    // The query already filters these out. This is the second lock on the one
    // field where a mistake cannot be undone once the customer has seen it.
    const note = {
      _id: "2".repeat(24),
      type: "internal_note",
      visibility: "internal",
      authorRole: "agent",
      authorName: "Priya",
      body: "Duplicate Razorpay charge — verify before refunding.",
      attachments: [],
      createdAt: new Date(),
    };

    expect(serializeMessageForUser(note)).toBeNull();
    // ...but staff see it in full.
    expect(serializeMessageForStaff(note).body).toContain("Razorpay");
  });

  it("hides the agent's name and id on a public reply", () => {
    const reply = {
      _id: "3".repeat(24),
      type: "message",
      visibility: "public",
      authorRole: "agent",
      authorName: "Priya Sharma",
      author: AGENT_ID,
      body: "We've refunded the duplicate charge.",
      attachments: [],
      createdAt: new Date(),
    };

    const payload = serializeMessageForUser(reply);
    const serialised = JSON.stringify(payload);

    expect(payload.author).toBe("support");
    expect(serialised).not.toContain("Priya");
    expect(serialised).not.toContain(AGENT_ID);
  });

  it("marks the customer's own message as theirs", () => {
    const own = {
      _id: "4".repeat(24),
      type: "message",
      visibility: "public",
      authorRole: "user",
      body: "I was charged twice.",
      attachments: [],
      createdAt: new Date(),
    };
    expect(serializeMessageForUser(own).author).toBe("you");
  });

  it("never emits an attachment URL — only an opaque index", () => {
    // Handing out a URL in the ticket payload would make the ticket read the
    // only authorisation check that ever happens for that file.
    const withFile = {
      _id: "5".repeat(24),
      type: "message",
      visibility: "public",
      authorRole: "user",
      body: "Screenshot attached",
      attachments: [
        {
          publicId: "support-attachments/secret_abc123",
          originalName: "statement.png",
          mimeType: "image/png",
          bytes: 1234,
        },
      ],
      createdAt: new Date(),
    };

    const payload = serializeMessageForUser(withFile);
    const serialised = JSON.stringify(payload);

    expect(payload.attachments[0].index).toBe(0);
    expect(payload.attachments[0].originalName).toBe("statement.png");
    expect(serialised).not.toContain("secret_abc123");
    expect(serialised).not.toContain("cloudinary");
    expect(payload.attachments[0]).not.toHaveProperty("publicId");
    expect(payload.attachments[0]).not.toHaveProperty("url");
  });
});

describe("reopen window", () => {
  it("allows a reopen immediately after resolution", () => {
    expect(canUserReopen(buildTicket({ status: "resolved", resolvedAt: new Date() }))).toBe(true);
  });

  it("refuses a reopen once the window has passed", () => {
    const longAgo = new Date(Date.now() - 30 * 86400000);
    expect(canUserReopen(buildTicket({ status: "resolved", resolvedAt: longAgo }))).toBe(false);
  });

  it("refuses a reopen on anything that is not resolved", () => {
    expect(canUserReopen(buildTicket({ status: "closed", resolvedAt: new Date() }))).toBe(false);
    expect(canUserReopen(buildTicket({ status: "open" }))).toBe(false);
    expect(canUserReopen(null)).toBe(false);
  });

  it("exposes the same answer to the UI as the API will enforce", () => {
    // A button that offers an action the server refuses is worse than no
    // button, so the serializer computes this rather than the client guessing.
    const fresh = serializeTicketForUser(buildTicket({ status: "resolved", resolvedAt: new Date() }));
    const stale = serializeTicketForUser(
      buildTicket({ status: "resolved", resolvedAt: new Date(Date.now() - 30 * 86400000) })
    );
    expect(fresh.canReopen).toBe(true);
    expect(stale.canReopen).toBe(false);
  });
});

describe("category vocabulary", () => {
  it("is shared by tickets and the knowledge base", () => {
    const KnowledgeBaseArticle = require("../../models/KnowledgeBaseArticle");
    const SupportTicket = require("../../models/SupportTicket");

    // The Help Center exists to deflect tickets, so "articles in the category
    // this customer is filing under" has to be a single lookup, not a mapping
    // table someone forgets to update.
    expect(KnowledgeBaseArticle.schema.path("category").enumValues.sort()).toEqual(
      SupportTicket.schema.path("category").enumValues.sort()
    );
    expect(SUPPORT_CATEGORY_VALUES.length).toBeGreaterThan(5);
  });
});
