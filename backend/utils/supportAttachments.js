"use strict";

const cloudinary = require("../config/cloudinary");
const { appConfig } = require("../config");
const { logger } = require("./logger");

/**
 * Delivery of private support attachments.
 *
 * Every other upload in this app is stored as a public Cloudinary asset: the
 * `secure_url` works forever for anyone who has it. That is acceptable for a
 * trader's own screenshot of their own trade. It is not acceptable here — a
 * support attachment is one customer's private material, and "the URL is long
 * and random" stops being a control the moment the link is forwarded, pasted
 * into a bug tracker, or captured in a log.
 *
 * Support attachments are therefore uploaded with `type: "authenticated"`, so
 * the ordinary delivery path returns 404 and the asset can only be fetched
 * through a URL signed with the account's API secret. The API mints one only
 * after checking that the caller owns the ticket or is support staff.
 *
 * Two flavours, with deliberately different guarantees:
 *
 *   inline   — a signed delivery URL. Renders directly in an <img>. It is
 *              unforgeable without the API secret, but it does NOT expire.
 *              True per-URL expiry on delivery needs Cloudinary token-based
 *              auth, which is an Advanced-plan feature; rather than pretend
 *              otherwise, this is documented as "unguessable, not expiring".
 *   download — a private download URL carrying a real `expires_at`. Genuinely
 *              time-limited on every plan, and serves the original file as an
 *              attachment. Used for the explicit "download" action.
 *
 * Both are only ever produced behind an authorisation check, and neither is
 * stored anywhere.
 */

const RESOURCE_TYPE = "image";
const DELIVERY_TYPE = "authenticated";

/**
 * Signed URL suitable for rendering in an <img> tag.
 * @param {string} publicId Cloudinary public id, as stored on the message.
 * @param {{ width?: number }} [options] Optional bounding width for a preview.
 */
function buildInlineAttachmentUrl(publicId, { width } = {}) {
  if (!publicId) return "";

  // A bounded, auto-format preview keeps a 5 MB phone screenshot from being
  // shipped at full resolution into a chat bubble. Cloudinary signs the
  // transformation along with the id, so a caller cannot swap the transform
  // for a different asset.
  const transformation = width
    ? [{ width, crop: "limit", quality: "auto", fetch_format: "auto" }]
    : [{ quality: "auto", fetch_format: "auto" }];

  return cloudinary.url(publicId, {
    resource_type: RESOURCE_TYPE,
    type: DELIVERY_TYPE,
    sign_url: true,
    secure: true,
    transformation,
  });
}

/**
 * Expiring URL that downloads the original file.
 * @param {string} publicId
 * @param {string} format Cloudinary format ("png", "jpg", ...).
 */
function buildDownloadAttachmentUrl(publicId, format) {
  if (!publicId) return "";

  const expiresAt =
    Math.floor(Date.now() / 1000) + Number(appConfig.support.attachmentUrlTtlSeconds || 60);

  return cloudinary.utils.private_download_url(publicId, format || "", {
    resource_type: RESOURCE_TYPE,
    type: DELIVERY_TYPE,
    expires_at: expiresAt,
    attachment: true,
  });
}

/**
 * Derive the Cloudinary format from a stored mime type. Cloudinary wants the
 * bare extension, and the upload allowlist has already guaranteed the mime is
 * one of three values — so this cannot be steered by a crafted filename.
 */
function formatFromMimeType(mimeType) {
  switch (String(mimeType || "").toLowerCase()) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/jpeg":
    default:
      return "jpg";
  }
}

/**
 * Best-effort cleanup. Never throws: an orphaned Cloudinary blob is a cost
 * problem, whereas a failed ticket write because an image delete timed out is
 * a customer problem.
 */
async function destroySupportAttachments(attachments = []) {
  const publicIds = (attachments || [])
    .map((item) => (typeof item === "string" ? item : item?.publicId))
    .filter(Boolean);

  if (!publicIds.length) return { destroyed: 0, failed: 0 };

  const results = await Promise.allSettled(
    publicIds.map((publicId) =>
      cloudinary.uploader.destroy(publicId, {
        resource_type: RESOURCE_TYPE,
        type: DELIVERY_TYPE,
      })
    )
  );

  const destroyed = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.length - destroyed;

  if (failed) {
    logger.warn("SUPPORT_ATTACHMENT_CLEANUP_PARTIAL", { attempted: publicIds.length, failed });
  }

  return { destroyed, failed };
}

/**
 * Shape an attachment for an API response.
 *
 * Note what is absent: no publicId and no URL. The client receives an opaque
 * index and calls GET /api/support/attachments/:messageId/:index, which
 * re-authorises on every fetch. Handing out a URL in the ticket payload would
 * make the ticket read the only authorisation check that ever happens.
 */
function serializeAttachment(attachment, index) {
  return {
    index,
    originalName: attachment?.originalName || `attachment-${index + 1}`,
    mimeType: attachment?.mimeType || "",
    bytes: attachment?.bytes || 0,
    width: attachment?.width || 0,
    height: attachment?.height || 0,
  };
}

module.exports = {
  buildInlineAttachmentUrl,
  buildDownloadAttachmentUrl,
  formatFromMimeType,
  destroySupportAttachments,
  serializeAttachment,
};
