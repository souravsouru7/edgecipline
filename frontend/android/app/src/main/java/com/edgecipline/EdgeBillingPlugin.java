package com.edgecipline;

import android.util.Log;

import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Google Play Billing bridge.
 *
 * Scope is deliberately narrow: this class opens Play's purchase UI and reports
 * what Play said. It NEVER decides whether the user is entitled to anything.
 *
 *   - It does not grant PRO.
 *   - It does not acknowledge purchases. The backend does that, after it has
 *     verified the purchase with Google's servers. Acknowledging here would
 *     confirm a purchase we had not validated, and would defeat the point of
 *     server-side verification: a patched APK could acknowledge anything.
 *   - It does not cache entitlement. Every purchase token goes to the backend
 *     and the backend's answer is the only one that counts.
 *
 * The JS layer listens for `purchaseUpdated` rather than awaiting the purchase
 * call. Play's flow outlives the call: the user can background the app, get
 * killed by the OS, and complete the purchase anyway. An event plus a
 * `getPurchases()` reconciliation on resume survives that; a pending promise
 * does not.
 *
 * Modelled on ChecklistNotificationPlugin, which is the existing custom-plugin
 * pattern in this app.
 */
@CapacitorPlugin(name = "EdgeBilling")
public class EdgeBillingPlugin extends Plugin implements PurchasesUpdatedListener {

    private static final String TAG = "EdgeBilling";

    private BillingClient billingClient;
    private boolean connecting = false;

    /**
     * ProductDetails cannot be constructed by us — it must come from Play — and
     * launchBillingFlow needs the exact instance that was queried. Cached from
     * the last getProducts() call so purchase() does not have to re-query.
     */
    private final Map<String, ProductDetails> productCache = new HashMap<>();

    @Override
    public void load() {
        super.load();
        billingClient = BillingClient.newBuilder(getContext())
                .setListener(this)
                // Required by Billing 7 to receive pending (not-yet-paid)
                // transactions, which are common in markets with cash payment
                // methods. Without it Play would simply not report them and the
                // user would be stuck with an invisible purchase.
                .enablePendingPurchases(
                        PendingPurchasesParams.newBuilder()
                                .enableOneTimeProducts()
                                .build()
                )
                .build();
    }

    @Override
    protected void handleOnDestroy() {
        if (billingClient != null && billingClient.isReady()) {
            billingClient.endConnection();
        }
        super.handleOnDestroy();
    }

    // ─── Connection ────────────────────────────────────────────────────────

    private interface ConnectionCallback {
        void onReady();
        void onFailure(String message);
    }

    /**
     * Ensure a live connection before doing anything. The Play Store app can be
     * updating, disabled, or absent entirely (some devices, most emulators), so
     * failure here is normal operation rather than an exceptional case — the JS
     * layer turns it into "in-app purchases are unavailable", never a crash.
     */
    private void withConnection(final ConnectionCallback callback) {
        if (billingClient == null) {
            callback.onFailure("Billing is not initialised");
            return;
        }
        if (billingClient.isReady()) {
            callback.onReady();
            return;
        }
        if (connecting) {
            callback.onFailure("Billing connection already in progress");
            return;
        }

        connecting = true;
        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult result) {
                connecting = false;
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    callback.onReady();
                } else {
                    Log.w(TAG, "Billing setup failed: " + result.getDebugMessage());
                    callback.onFailure(describeResult(result));
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                connecting = false;
                // Not an error on its own — the next call reconnects. Play
                // disconnects routinely when the Store app updates itself.
                Log.i(TAG, "Billing service disconnected; will reconnect on next call");
            }
        });
    }

    private static String describeResult(BillingResult result) {
        String message = result.getDebugMessage();
        return (message == null || message.isEmpty())
                ? ("Billing error " + result.getResponseCode())
                : message;
    }

    // ─── Availability ──────────────────────────────────────────────────────

    /**
     * Whether this device can transact at all. Called before any paywall is
     * shown so the app can explain the situation instead of opening a checkout
     * that cannot complete.
     */
    @PluginMethod
    public void isAvailable(final PluginCall call) {
        if (billingClient == null) {
            JSObject result = new JSObject();
            result.put("available", false);
            result.put("reason", "not_initialised");
            call.resolve(result);
            return;
        }

        withConnection(new ConnectionCallback() {
            @Override
            public void onReady() {
                BillingResult supported = billingClient.isFeatureSupported(
                        BillingClient.FeatureType.SUBSCRIPTIONS
                );
                JSObject result = new JSObject();
                boolean ok = supported.getResponseCode() == BillingClient.BillingResponseCode.OK;
                result.put("available", ok);
                if (!ok) result.put("reason", "subscriptions_unsupported");
                call.resolve(result);
            }

            @Override
            public void onFailure(String message) {
                JSObject result = new JSObject();
                result.put("available", false);
                result.put("reason", message);
                call.resolve(result);
            }
        });
    }

    // ─── Product catalogue ─────────────────────────────────────────────────

    /**
     * Fetch live, localised pricing from Play.
     *
     * Prices are never sent from our backend and never hard-coded here: Play
     * Console owns them, and only Play knows the user's country, currency and
     * tax treatment. Showing anything else risks quoting a price the user is
     * not charged.
     */
    @PluginMethod
    public void getProducts(final PluginCall call) {
        final String productId = call.getString("productId");
        if (productId == null || productId.isEmpty()) {
            call.reject("productId is required");
            return;
        }

        withConnection(new ConnectionCallback() {
            @Override
            public void onReady() {
                QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                        .setProductList(Collections.singletonList(
                                QueryProductDetailsParams.Product.newBuilder()
                                        .setProductId(productId)
                                        .setProductType(BillingClient.ProductType.SUBS)
                                        .build()
                        ))
                        .build();

                billingClient.queryProductDetailsAsync(params, (result, productDetailsList) -> {
                    if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                        call.reject(describeResult(result), String.valueOf(result.getResponseCode()));
                        return;
                    }

                    JSArray offers = new JSArray();
                    productCache.clear();

                    for (ProductDetails details : productDetailsList) {
                        productCache.put(details.getProductId(), details);
                        List<ProductDetails.SubscriptionOfferDetails> offerDetails =
                                details.getSubscriptionOfferDetails();
                        if (offerDetails == null) continue;

                        for (ProductDetails.SubscriptionOfferDetails offer : offerDetails) {
                            List<ProductDetails.PricingPhase> phases =
                                    offer.getPricingPhases().getPricingPhaseList();
                            if (phases.isEmpty()) continue;

                            // The LAST phase is the recurring price. Earlier
                            // phases are introductory or free-trial pricing, so
                            // taking phases.get(0) would advertise an intro
                            // price as if it were the ongoing one.
                            ProductDetails.PricingPhase recurring = phases.get(phases.size() - 1);
                            ProductDetails.PricingPhase first = phases.get(0);

                            JSObject entry = new JSObject();
                            entry.put("productId", details.getProductId());
                            entry.put("basePlanId", offer.getBasePlanId());
                            entry.put("offerId", offer.getOfferId());
                            entry.put("offerToken", offer.getOfferToken());
                            entry.put("formattedPrice", recurring.getFormattedPrice());
                            entry.put("priceAmountMicros", recurring.getPriceAmountMicros());
                            entry.put("currencyCode", recurring.getPriceCurrencyCode());
                            entry.put("billingPeriod", recurring.getBillingPeriod());
                            entry.put("hasIntroductoryOffer", phases.size() > 1);
                            entry.put("introFormattedPrice", first.getFormattedPrice());
                            entry.put("title", details.getTitle());
                            entry.put("description", details.getDescription());
                            offers.put(entry);
                        }
                    }

                    JSObject response = new JSObject();
                    response.put("offers", offers);
                    call.resolve(response);
                });
            }

            @Override
            public void onFailure(String message) {
                call.reject(message, "BILLING_UNAVAILABLE");
            }
        });
    }

    // ─── Purchase ──────────────────────────────────────────────────────────

    /**
     * Launch Play's purchase UI.
     *
     * Resolves as soon as the sheet is on screen — NOT when the purchase
     * completes. The outcome arrives on the `purchaseUpdated` listener, which
     * is also what fires if the user finishes the purchase after the app has
     * been backgrounded or killed.
     *
     * `obfuscatedAccountId` comes from the backend and binds the purchase to
     * the signed-in Edgecipline account. It is what stops a purchase made by
     * one user from being claimed by whoever signs in next on this device.
     */
    @PluginMethod
    public void purchase(final PluginCall call) {
        final String productId = call.getString("productId");
        final String offerToken = call.getString("offerToken");
        final String obfuscatedAccountId = call.getString("obfuscatedAccountId");

        if (productId == null || offerToken == null) {
            call.reject("productId and offerToken are required");
            return;
        }

        final ProductDetails details = productCache.get(productId);
        if (details == null) {
            // launchBillingFlow requires the exact ProductDetails instance Play
            // handed us, so it cannot be reconstructed here.
            call.reject("Call getProducts() before purchase()", "PRODUCT_NOT_LOADED");
            return;
        }

        withConnection(new ConnectionCallback() {
            @Override
            public void onReady() {
                BillingFlowParams.Builder builder = BillingFlowParams.newBuilder()
                        .setProductDetailsParamsList(Collections.singletonList(
                                BillingFlowParams.ProductDetailsParams.newBuilder()
                                        .setProductDetails(details)
                                        .setOfferToken(offerToken)
                                        .build()
                        ));

                if (obfuscatedAccountId != null && !obfuscatedAccountId.isEmpty()) {
                    builder.setObfuscatedAccountId(obfuscatedAccountId);
                }

                BillingResult result = billingClient.launchBillingFlow(
                        getActivity(), builder.build()
                );

                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    call.reject(describeResult(result), String.valueOf(result.getResponseCode()));
                    return;
                }

                JSObject response = new JSObject();
                response.put("launched", true);
                call.resolve(response);
            }

            @Override
            public void onFailure(String message) {
                call.reject(message, "BILLING_UNAVAILABLE");
            }
        });
    }

    /**
     * Play's callback for every purchase outcome, including ones completed
     * while the app was not in the foreground.
     */
    @Override
    public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        JSObject event = new JSObject();
        int code = result.getResponseCode();
        event.put("responseCode", code);

        if (code == BillingClient.BillingResponseCode.OK && purchases != null) {
            event.put("status", "purchased");
            event.put("purchases", serializePurchases(purchases));
        } else if (code == BillingClient.BillingResponseCode.USER_CANCELED) {
            // Not an error. The user changed their mind, and the UI should
            // simply close rather than show a failure.
            event.put("status", "cancelled");
        } else if (code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
            // The subscription exists but this install does not know about it —
            // a reinstall, or a backend call that failed after payment. The JS
            // layer answers this by running the restore flow, which re-verifies
            // server-side and grants what the user already paid for.
            event.put("status", "already_owned");
        } else {
            event.put("status", "failed");
            event.put("message", describeResult(result));
        }

        notifyListeners("purchaseUpdated", event, true);
    }

    // ─── Reconciliation ────────────────────────────────────────────────────

    /**
     * Every subscription purchase Play currently associates with this device.
     *
     * Drives both "Restore purchases" and the silent reconciliation the app
     * runs on launch — which is what recovers a purchase whose verification
     * call never reached the backend (network dropped, app killed, backend
     * briefly down). Returns tokens only; entitlement still comes from the
     * server.
     */
    @PluginMethod
    public void getPurchases(final PluginCall call) {
        withConnection(new ConnectionCallback() {
            @Override
            public void onReady() {
                QueryPurchasesParams params = QueryPurchasesParams.newBuilder()
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build();

                billingClient.queryPurchasesAsync(params, (result, purchases) -> {
                    if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                        call.reject(describeResult(result), String.valueOf(result.getResponseCode()));
                        return;
                    }
                    JSObject response = new JSObject();
                    response.put("purchases", serializePurchases(purchases));
                    call.resolve(response);
                });
            }

            @Override
            public void onFailure(String message) {
                call.reject(message, "BILLING_UNAVAILABLE");
            }
        });
    }

    private JSArray serializePurchases(List<Purchase> purchases) {
        JSArray array = new JSArray();
        if (purchases == null) return array;

        for (Purchase purchase : purchases) {
            JSObject entry = new JSObject();
            entry.put("purchaseToken", purchase.getPurchaseToken());
            // PURCHASED(1) / PENDING(2). A pending purchase has NOT been paid
            // for; the backend refuses to grant on it, and the UI must say
            // "waiting for payment" rather than "you're subscribed".
            entry.put("purchaseState", purchase.getPurchaseState());
            entry.put("isAcknowledged", purchase.isAcknowledged());
            entry.put("purchaseTime", purchase.getPurchaseTime());

            JSArray products = new JSArray();
            List<String> productIds = purchase.getProducts();
            for (String id : (productIds == null ? new ArrayList<String>() : productIds)) {
                products.put(id);
            }
            entry.put("products", products);
            array.put(entry);
        }
        return array;
    }

    // Deliberately absent: an acknowledge() method.
    //
    // Acknowledgement is the step that tells Google we have granted what was
    // paid for, and Google auto-refunds anything left unacknowledged for three
    // days. Doing it from the client would mean confirming a purchase the
    // server has not verified — so it lives in googlePlayBillingService, behind
    // verification, where a modified APK cannot reach it.
}
