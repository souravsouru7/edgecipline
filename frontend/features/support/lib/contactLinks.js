/**
 * Deep links for the two external support channels.
 *
 * The rule both of these obey: nothing sensitive travels in a URL. A WhatsApp
 * deep link ends up in the recipient's chat history, the sender's clipboard,
 * and any URL-preview service that happens to see it; a mailto ends up in the
 * user's Sent folder and in their mail provider's logs. So these carry a
 * category name and, at most, a ticket code — never an email address, an
 * account id, a token, a payment reference, or free-typed problem detail.
 */

const MAX_PREFILL = 180;

function clean(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_PREFILL);
}

/**
 * WhatsApp deep link.
 *
 * `wa.me` is used rather than `whatsapp://` because it degrades properly: on a
 * phone with WhatsApp it opens the app, on a phone without it opens the install
 * page, and on a desktop browser it opens WhatsApp Web. The `whatsapp://`
 * scheme just fails silently when nothing handles it, which looks to the
 * customer like a broken button.
 */
export function buildWhatsAppLink({ number, categoryLabel, ticketCode } = {}) {
  const digits = String(number || "").replace(/[^\d]/g, "");
  if (!digits) return "";

  const subject = ticketCode
    ? `ticket ${ticketCode}`
    : categoryLabel
      ? `${categoryLabel.toLowerCase()}`
      : "my account";

  const text = clean(`Hi Edgecipline Support, I need help with ${subject}.`);
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/**
 * mailto link.
 *
 * The subject carries the ticket code when there is one, so a reply lands
 * against the right case even though inbound email is not yet parsed into the
 * ticket system. The body is a short prompt, not a form — anything the
 * customer types goes into their mail client, not into a URL.
 */
export function buildMailtoLink({ email, categoryLabel, ticketCode } = {}) {
  if (!email) return "";

  const subject = ticketCode
    ? `Edgecipline Support — Ticket ${ticketCode}`
    : categoryLabel
      ? `Edgecipline Support — ${categoryLabel}`
      : "Edgecipline Support";

  const body = ticketCode
    ? `Ticket: ${ticketCode}\n\nPlease describe what you need help with:\n`
    : "Please describe what you need help with:\n";

  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
