// Pure presentation rules for the settings page's subscription card, kept
// React-free so they run under `node --test`. `subscription` is the resolved
// object from GET /auth/me (utils/premium on the server): status, provider,
// planLabel, expiresAt, and — for Google Play — cancelAtPeriodEnd and state.

// Where a Google Play subscriber cancels, changes payment method or resumes.
// Deep-links to our product in the Play Store's Subscriptions screen; the app
// itself cannot do any of those — Google owns the agreement.
export const PLAY_MANAGE_URL =
  "https://play.google.com/store/account/subscriptions?sku=edgecipline_pro&package=com.edgecipline";

// Play subscriptions renew on their date unless cancelled in the Play Store,
// in which case access simply ends there; Razorpay purchases always just end.
// "Expires" on a renewing plan reads like a warning and "Renews" on a
// cancelled one is a lie, so name the date for what it is.
export function resolveExpiryLabel(subscription) {
  if (subscription?.status === "active" && subscription?.provider === "google_play") {
    return subscription.cancelAtPeriodEnd ? "Ends" : "Renews";
  }
  return "Expires";
}

// Lifecycle notices for a Play subscription. `state` is the backend's
// normalised Play state (constants/googlePlay); a Razorpay purchase has none.
export function describePlayLifecycle(subscription, expiryDate) {
  if (!subscription || subscription.provider !== "google_play") return null;
  if (subscription.state === "pending") {
    return {
      tone: "info",
      text: "Waiting for Google Play to confirm your payment. Premium unlocks automatically once it clears.",
    };
  }
  if (subscription.state === "grace_period") {
    return {
      tone: "warn",
      text: "Payment failed — update your payment method in Google Play to keep your subscription.",
    };
  }
  if (subscription.state === "on_hold") {
    return {
      tone: "warn",
      text: "Your subscription is on hold because a payment failed. Fix your payment method in Google Play to restore access.",
    };
  }
  if (subscription.cancelAtPeriodEnd && subscription.status === "active") {
    return {
      tone: "info",
      text: `Auto-renew is off — access ends on ${expiryDate || "your current period end"}.`,
    };
  }
  return null;
}

/**
 * Whether the card should offer the Play-specific actions ("Manage
 * subscription" in the Play Store, "Change plan" via the Play paywall).
 *
 * `platformAllowsPlayActions` is separate from the subscription data on purpose.
 * A Play subscription belongs to the account, so the same user sees this card on
 * web and on iOS — and "Manage subscription" opens play.google.com, an external
 * purchase-management link. Inside an iOS app that is a Guideline 3.1.1 / 3.1.3
 * problem, so the platform gets a vote, not just the provider.
 *
 * Fail-closed: omit the argument and the actions are hidden. A caller that
 * forgets the platform check should lose a button, not ship an external payment
 * link to App Review.
 *
 * The subscription's status and renewal date stay visible everywhere — showing
 * what someone already pays for is not a purchase surface.
 */
export function showsPlayActions(subscription, isPremium, platformAllowsPlayActions) {
  return (
    Boolean(isPremium) &&
    subscription?.provider === "google_play" &&
    platformAllowsPlayActions === true
  );
}
