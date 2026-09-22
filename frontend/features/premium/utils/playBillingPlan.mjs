// Pure plan/replacement logic for the Google Play paywall. Kept free of React
// and of the `@/` alias so it can run under `node --test` and be imported by
// the paywall component unchanged.

// Ordered cheapest-first, matching the web catalogue and the backend's
// BASE_PLANS (constants/googlePlay.js). Play returns offers in no guaranteed
// order, so the paywall imposes one — and anything not in this list is not
// something we sell, so it is never shown or charged.
export const BASE_PLAN_ORDER = Object.freeze([
  "edgecipline-pro-monthly",
  "edgecipline-pro-3month",
  "edgecipline-pro-6month",
]);

export const BASE_PLAN_LABELS = Object.freeze({
  "edgecipline-pro-monthly": "1 month",
  "edgecipline-pro-3month": "3 months",
  "edgecipline-pro-6month": "6 months",
});

// Play purchase states, from Purchase.getPurchaseState().
export const PURCHASE_STATE_PURCHASED = 1;
export const PURCHASE_STATE_PENDING = 2;

// How a plan change is charged. The choice is a product decision, so it lives
// here in one place rather than in the native plugin:
//
//   Longer plan  -> CHARGE_FULL_PRICE. The new plan starts now and is charged
//                   now; whatever was left on the old plan is carried over on
//                   top. The user sees exactly one charge for exactly the
//                   price shown, which is what "upgrade" should feel like.
//   Shorter plan -> WITH_TIME_PRORATION. Switch now, and the unused value of
//                   the longer plan becomes time on the shorter one. Nobody
//                   pays twice for the same days, and Play still issues a new
//                   purchase token immediately, so the verify path is the same
//                   as for a first purchase. (DEFERRED would be the classic
//                   "downgrade at period end", but its client callback shape
//                   is inconsistent across Play Store versions.)
//
// Both modes return a new purchase token in onPurchasesUpdated, and Play
// links it to the old one; the backend supersedes the old row from that link.
//
// Throws for a plan outside BASE_PLAN_ORDER: a plan we do not sell must never
// be charged under a guessed mode.
export function resolveReplacementMode(fromBasePlanId, toBasePlanId) {
  const from = BASE_PLAN_ORDER.indexOf(fromBasePlanId);
  const to = BASE_PLAN_ORDER.indexOf(toBasePlanId);
  if (from === -1 || to === -1) {
    throw new Error("Unknown base plan");
  }
  return to > from ? "CHARGE_FULL_PRICE" : "WITH_TIME_PRORATION";
}

// Base plans only, and only the ones we sell, in catalogue order. An offer
// with an offerId is a promotional or free-trial variant of a base plan;
// showing both would list the same tier twice at two different prices. A base
// plan that exists in Play Console but not in BASE_PLAN_ORDER is not offered
// at all — the backend refuses it (PLAY_BASE_PLAN_UNKNOWN), so listing it
// would take money for nothing.
export function selectSellableOffers(playOffers) {
  return (playOffers || [])
    .filter((offer) => offer && !offer.offerId && BASE_PLAN_ORDER.includes(offer.basePlanId))
    .sort((a, b) => BASE_PLAN_ORDER.indexOf(a.basePlanId) - BASE_PLAN_ORDER.indexOf(b.basePlanId));
}

// Same 16-hex fingerprint the backend derives (utils/playAccountIdentity), so
// the device can tell WHICH of its purchases the server's currentSubscription
// refers to without the server ever handing a token back down. `subtle` is
// injectable so the function can run under node:test without a window.
export async function fingerprintPurchaseToken(token, subtle = globalThis.crypto?.subtle) {
  if (!token || !subtle) return null;
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(String(token)));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

// The device-side purchase that backs the server's idea of the current plan:
// the PURCHASED entry for our product whose fingerprint equals the server's
// `purchaseRef`. The match matters on a shared phone — Play returns whatever
// the signed-in GOOGLE account owns, which may be a different Edgecipline
// user's subscription, and replacing THAT would cancel their plan. No match
// means "not a switch": a plain purchase, and ITEM_ALREADY_OWNED → restore
// still catches a wrong guess. Only the server decides entitlement; this
// merely finds the token Play needs in order to replace it.
export async function findCurrentDevicePurchase(purchases, productId, purchaseRef, subtle) {
  if (!purchaseRef) return null;
  const candidates = (purchases || []).filter(
    (purchase) =>
      purchase?.purchaseState === PURCHASE_STATE_PURCHASED &&
      (purchase.products || []).includes(productId) &&
      purchase.purchaseToken
  );
  for (const purchase of candidates) {
    const ref = await fingerprintPurchaseToken(purchase.purchaseToken, subtle);
    if (ref && ref === purchaseRef) return purchase;
  }
  return null;
}
