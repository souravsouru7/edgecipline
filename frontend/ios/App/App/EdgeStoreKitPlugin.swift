import Foundation
import Capacitor
import StoreKit

/**
 Apple In-App Purchase (StoreKit 2) for the Edgecipline Pro subscriptions.

 The iOS counterpart of the Android EdgeBillingPlugin, and like it, it decides
 nothing about entitlement. It hands JS Apple's SIGNED transaction
 (`jwsRepresentation`); JS posts that to /api/payments/app-store/verify, and the
 backend's answer is the only source of truth.

     isAvailable()                         -> { available }
     getProducts({ productIds })           -> { products: [...] }
     purchase({ productId, appAccountToken })
         -> { status: "purchased", signedTransaction, transactionId, originalTransactionId, productId }
          | { status: "cancelled" } | { status: "pending" }
     finishTransaction({ transactionId })  -> resolve()
     getCurrentEntitlements()              -> { transactions: [signedTransaction] }
     restore()                             -> { transactions: [signedTransaction] }
     manageSubscriptions()                 -> resolve()
     event "transactionUpdated"            -> { signedTransaction, transactionId, originalTransactionId, productId }

 A transaction is only finished after the backend confirms it. An unfinished
 transaction is redelivered by StoreKit on every launch (Transaction.updates /
 Transaction.unfinished), so a crash or network failure between Apple charging
 the user and our backend recording it can never lose the purchase.

 Registered by MainViewController.capacitorDidLoad(), like EdgeAuthStorage.
 */
@objc(EdgeStoreKitPlugin)
public class EdgeStoreKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EdgeStoreKitPlugin"
    public let jsName = "EdgeStoreKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishTransaction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCurrentEntitlements", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manageSubscriptions", returnType: CAPPluginReturnPromise)
    ]

    private var updatesTask: Task<Void, Never>?

    override public func load() {
        // Renewals, purchases approved later (Ask to Buy), purchases made on
        // another device and anything left unfinished by a previous launch all
        // arrive here. JS forwards each to the backend, then finishes it.
        updatesTask = Task.detached { [weak self] in
            for await result in Transaction.updates {
                self?.emit(result)
            }
        }
        Task.detached { [weak self] in
            for await result in Transaction.unfinished {
                self?.emit(result)
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    private func emit(_ result: VerificationResult<Transaction>) {
        // Unverified results are dropped: the backend would reject them anyway,
        // and they must never be finished as though they were real.
        guard case .verified(let transaction) = result else { return }
        notifyListeners("transactionUpdated", data: [
            "signedTransaction": result.jwsRepresentation,
            "transactionId": String(transaction.id),
            "originalTransactionId": String(transaction.originalID),
            "productId": transaction.productID
        ], retainUntilConsumed: true)
    }

    // MARK: - isAvailable

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": AppStore.canMakePayments])
    }

    // MARK: - getProducts

    @objc func getProducts(_ call: CAPPluginCall) {
        let ids = (call.getArray("productIds", String.self) ?? []).filter { !$0.isEmpty }
        guard !ids.isEmpty else {
            call.reject("productIds is required", "INVALID_ARGUMENT")
            return
        }
        Task {
            do {
                let products = try await Product.products(for: ids)
                call.resolve(["products": products.map(Self.describe)])
            } catch {
                call.reject("Could not load products", "PRODUCTS_FAILED", error)
            }
        }
    }

    /// Only Apple's own formatted price is ever shown to the user; the raw
    /// decimal is for analytics.
    private static func describe(_ product: Product) -> [String: Any] {
        var info: [String: Any] = [
            "productId": product.id,
            "displayName": product.displayName,
            "description": product.description,
            "displayPrice": product.displayPrice,
            "price": NSDecimalNumber(decimal: product.price).stringValue
        ]
        if let subscription = product.subscription {
            info["period"] = [
                "unit": unitName(subscription.subscriptionPeriod.unit),
                "value": subscription.subscriptionPeriod.value
            ]
            if let intro = subscription.introductoryOffer {
                info["introOffer"] = [
                    "displayPrice": intro.displayPrice,
                    "paymentMode": paymentModeName(intro.paymentMode),
                    "period": [
                        "unit": unitName(intro.period.unit),
                        "value": intro.period.value
                    ],
                    "periodCount": intro.periodCount
                ]
            }
        }
        return info
    }

    private static func unitName(_ unit: Product.SubscriptionPeriod.Unit) -> String {
        switch unit {
        case .day: return "day"
        case .week: return "week"
        case .month: return "month"
        case .year: return "year"
        @unknown default: return "unknown"
        }
    }

    private static func paymentModeName(_ mode: Product.SubscriptionOffer.PaymentMode) -> String {
        switch mode {
        case .freeTrial: return "free_trial"
        case .payAsYouGo: return "pay_as_you_go"
        case .payUpFront: return "pay_up_front"
        default: return "unknown"
        }
    }

    // MARK: - purchase

    @objc func purchase(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId"), !productId.isEmpty else {
            call.reject("productId is required", "INVALID_ARGUMENT")
            return
        }
        // The backend refuses any transaction without the caller's token, so a
        // purchase without one could charge the user and grant nothing.
        guard let tokenString = call.getString("appAccountToken"),
              let accountToken = UUID(uuidString: tokenString) else {
            call.reject("A valid appAccountToken is required", "INVALID_ARGUMENT")
            return
        }
        Task {
            do {
                guard let product = try await Product.products(for: [productId]).first else {
                    call.reject("Product not found", "PRODUCT_NOT_FOUND")
                    return
                }
                let result = try await product.purchase(options: [.appAccountToken(accountToken)])
                switch result {
                case .success(let verification):
                    guard case .verified(let transaction) = verification else {
                        call.reject("Apple could not verify this purchase", "UNVERIFIED")
                        return
                    }
                    // Deliberately NOT finished here: JS finishes only after
                    // the backend has recorded it.
                    call.resolve([
                        "status": "purchased",
                        "signedTransaction": verification.jwsRepresentation,
                        "transactionId": String(transaction.id),
                        "originalTransactionId": String(transaction.originalID),
                        "productId": transaction.productID
                    ])
                case .userCancelled:
                    call.resolve(["status": "cancelled"])
                case .pending:
                    // Ask to Buy / SCA. The outcome arrives later via
                    // transactionUpdated.
                    call.resolve(["status": "pending"])
                @unknown default:
                    call.reject("Unknown purchase result", "UNKNOWN")
                }
            } catch {
                call.reject("Purchase failed", "PURCHASE_FAILED", error)
            }
        }
    }

    // MARK: - finishTransaction

    @objc func finishTransaction(_ call: CAPPluginCall) {
        guard let idString = call.getString("transactionId"), let id = UInt64(idString) else {
            call.reject("transactionId is required", "INVALID_ARGUMENT")
            return
        }
        Task {
            for await result in Transaction.unfinished {
                if case .verified(let transaction) = result, transaction.id == id {
                    await transaction.finish()
                    break
                }
            }
            // Already finished (or never ours) is not an error: finishing is
            // idempotent from the caller's point of view.
            call.resolve()
        }
    }

    // MARK: - entitlements / restore

    @objc func getCurrentEntitlements(_ call: CAPPluginCall) {
        Task {
            call.resolve(["transactions": await Self.currentEntitlementJWS()])
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        Task {
            do {
                // Forces a sync with the App Store; may prompt for the Apple ID
                // password, which is why it only runs on an explicit tap.
                try await AppStore.sync()
                call.resolve(["transactions": await Self.currentEntitlementJWS()])
            } catch {
                call.reject("Restore failed", "RESTORE_FAILED", error)
            }
        }
    }

    private static func currentEntitlementJWS() async -> [String] {
        var signed: [String] = []
        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result, transaction.productType == .autoRenewable {
                signed.append(result.jwsRepresentation)
            }
        }
        return signed
    }

    // MARK: - manageSubscriptions

    @objc func manageSubscriptions(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard let scene = self.bridge?.viewController?.view.window?.windowScene else {
                call.reject("No window to present from", "NO_WINDOW")
                return
            }
            do {
                try await AppStore.showManageSubscriptions(in: scene)
                call.resolve()
            } catch {
                call.reject("Could not open subscriptions", "MANAGE_FAILED", error)
            }
        }
    }
}
