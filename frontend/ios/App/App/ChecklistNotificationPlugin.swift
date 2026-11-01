import Foundation
import Capacitor
import UserNotifications

/**
 iOS counterpart of the Android ChecklistNotificationPlugin (pre-trade checklist
 reminder). Same plugin name, same methods, same payloads, so
 plugins/ChecklistNotificationPlugin.js and the checklist screens drive one code
 path on both platforms:

     configure({ enabled, market, notificationTime, repeatMode, customDays,
                 persistent, resetEnabled, resetTime, strategyName, items })
     requestPermission()            -> { granted }
     syncItems({ items, market })
     cancel({ market })
     getState({ market })           -> { enabled, ..., items: [{id,label,checked}] }
     event "checklistItemToggled"   -> { itemId, checked }

 What differs from Android, because iOS does not allow it:
   - No ongoing (sticky) notification. The checklist is a normal notification
     that fires at the chosen time(s) and is shown again immediately ("Save &
     show now"). `persistent` is stored for parity but has no iOS equivalent.
   - Items are ticked from the notification's action buttons (long-press it).
     Each tick re-posts the notification with the updated list, so it reads as
     the same checklist progressing rather than a stack of copies.
   - The daily reset runs lazily: iOS gives no background callback at an
     arbitrary time, so ticks are cleared the first time the state is touched
     after the reset time has passed.

 Ticks made while the app is not running are handled by ChecklistReminders,
 which AppDelegate installs as the notification delegate at launch (before the
 Capacitor bridge exists). Once the bridge is up, Capacitor's NotificationRouter
 takes over as delegate and forwards local notifications here.
 */
@objc(ChecklistNotificationPlugin)
public class ChecklistNotificationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ChecklistNotificationPlugin"
    public let jsName = "ChecklistNotification"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "syncItems", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        let reminders = ChecklistReminders.shared
        reminders.onToggle = { [weak self] itemId, checked in
            self?.notifyListeners("checklistItemToggled", data: ["itemId": itemId, "checked": checked])
        }
        if let router = bridge?.notificationRouter {
            router.localNotificationHandler = reminders
            reminders.attach(router: router)
        }
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            call.resolve(["granted": granted])
        }
    }

    @objc func configure(_ call: CAPPluginCall) {
        let market = call.getString("market") ?? "Forex"
        var config = ChecklistReminders.shared.load(market: market)
        config.enabled = call.getBool("enabled") ?? false
        config.notificationTime = call.getString("notificationTime") ?? "09:00"
        config.repeatMode = call.getString("repeatMode") ?? "daily"
        if let days = call.getArray("customDays", Int.self) { config.customDays = days }
        config.persistent = call.getBool("persistent") ?? false
        config.resetEnabled = call.getBool("resetEnabled") ?? true
        config.resetTime = call.getString("resetTime") ?? "00:00"
        config.strategyName = call.getString("strategyName") ?? "Pre-Trade Checklist"
        if let raw = call.getArray("items", JSObject.self), !raw.isEmpty {
            // Keep today's ticks for rules that are still there, like Android's mergeItems.
            let previous = Dictionary(config.items.map { ($0.id, $0.checked) }, uniquingKeysWith: { first, _ in first })
            config.items = ChecklistReminders.parseItems(raw).map {
                ChecklistReminders.Item(id: $0.id, label: $0.label, checked: previous[$0.id] ?? false)
            }
        }
        ChecklistReminders.shared.apply(config, market: market) {
            call.resolve()
        }
    }

    @objc func syncItems(_ call: CAPPluginCall) {
        guard let raw = call.getArray("items", JSObject.self) else {
            call.reject("items is required")
            return
        }
        let market = call.getString("market") ?? "Forex"
        ChecklistReminders.shared.sync(items: ChecklistReminders.parseItems(raw), market: market)
        call.resolve()
    }

    @objc func cancel(_ call: CAPPluginCall) {
        let market = call.getString("market") ?? "Forex"
        var config = ChecklistReminders.shared.load(market: market)
        config.enabled = false
        ChecklistReminders.shared.apply(config, market: market) {
            call.resolve()
        }
    }

    @objc func getState(_ call: CAPPluginCall) {
        let market = call.getString("market") ?? "Forex"
        let config = ChecklistReminders.shared.loadWithReset(market: market)
        call.resolve([
            "supported": true,
            "enabled": config.enabled,
            "notificationTime": config.notificationTime,
            "repeatMode": config.repeatMode,
            "persistent": config.persistent,
            "resetEnabled": config.resetEnabled,
            "resetTime": config.resetTime,
            "strategyName": config.strategyName,
            "items": config.items.map { ["id": $0.id, "label": $0.label, "checked": $0.checked] }
        ])
    }
}

/// Storage, scheduling and action handling, independent of the Capacitor bridge
/// so a tick from the lock screen works even when the app was not running.
final class ChecklistReminders: NSObject, UNUserNotificationCenterDelegate, NotificationHandlerProtocol {
    static let shared = ChecklistReminders()

    struct Item: Codable {
        var id: String
        var label: String
        var checked: Bool
    }

    struct Config: Codable {
        var enabled = false
        var notificationTime = "09:00"
        var repeatMode = "daily"
        var customDays: [Int] = [1, 2, 3, 4, 5]   // ISO: 1 = Monday … 7 = Sunday
        var persistent = false
        var resetEnabled = true
        var resetTime = "00:00"
        var strategyName = "Pre-Trade Checklist"
        var items: [Item] = []
        var lastReset: Date?
    }

    static let maxItems = 8
    private static let marketKey = "edgeChecklistMarket"
    private static let toggleActionPrefix = "EDGE_CHK_TOGGLE|"
    private static let resetAction = "EDGE_CHK_RESET"

    var onToggle: ((String, Bool) -> Void)?
    private weak var router: NotificationRouter?
    private var pendingForeignResponses: [UNNotificationResponse] = []
    private let center = UNUserNotificationCenter.current()

    // MARK: - Storage

    private func storageKey(_ market: String) -> String { "edge.checklist.\(market)" }

    func load(market: String) -> Config {
        guard let data = UserDefaults.standard.data(forKey: storageKey(market)),
              let config = try? JSONDecoder().decode(Config.self, from: data) else { return Config() }
        return config
    }

    func loadWithReset(market: String) -> Config {
        var config = load(market: market)
        if applyResetIfDue(&config) { save(config, market: market) }
        return config
    }

    private func save(_ config: Config, market: String) {
        if let data = try? JSONEncoder().encode(config) {
            UserDefaults.standard.set(data, forKey: storageKey(market))
        }
    }

    static func parseItems(_ raw: [JSObject]) -> [Item] {
        raw.prefix(maxItems).enumerated().map { index, object in
            Item(
                id: (object["id"] as? String) ?? String(index),
                label: (object["label"] as? String) ?? "",
                checked: (object["checked"] as? Bool) ?? false
            )
        }
    }

    /// Clears ticks once per reset period. Returns true if anything changed.
    private func applyResetIfDue(_ config: inout Config, now: Date = Date()) -> Bool {
        guard config.resetEnabled else { return false }
        let (hour, minute) = Self.parseTime(config.resetTime)
        let calendar = Calendar.current
        guard var boundary = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: now) else { return false }
        if boundary > now { boundary = calendar.date(byAdding: .day, value: -1, to: boundary) ?? boundary }
        if let last = config.lastReset, last >= boundary { return false }
        config.items = config.items.map { Item(id: $0.id, label: $0.label, checked: false) }
        config.lastReset = now
        return true
    }

    // MARK: - Public operations

    func apply(_ config: Config, market: String, completion: @escaping () -> Void) {
        var config = config
        _ = applyResetIfDue(&config)
        save(config, market: market)
        removeAll(market: market) { [weak self] in
            guard let self = self else { return completion() }
            guard config.enabled, !config.items.isEmpty else { return completion() }
            self.registerCategory(for: config, market: market) {
                self.schedule(config, market: market)
                // Android shows the checklist straight away on save; do the same.
                self.postLive(config, market: market, withSound: false)
                completion()
            }
        }
    }

    func sync(items: [Item], market: String) {
        var config = loadWithReset(market: market)
        config.items = items
        save(config, market: market)
        refreshLiveIfShown(config, market: market)
    }

    private func toggle(itemId: String, market: String) {
        var config = loadWithReset(market: market)
        guard let index = config.items.firstIndex(where: { $0.id == itemId }) else { return }
        config.items[index].checked.toggle()
        let checked = config.items[index].checked
        save(config, market: market)
        registerCategory(for: config, market: market) {
            self.postLive(config, market: market, withSound: false)
        }
        DispatchQueue.main.async { self.onToggle?(itemId, checked) }
    }

    private func resetTicks(market: String) {
        var config = load(market: market)
        config.items = config.items.map { Item(id: $0.id, label: $0.label, checked: false) }
        config.lastReset = Date()
        save(config, market: market)
        registerCategory(for: config, market: market) {
            self.postLive(config, market: market, withSound: false)
        }
        DispatchQueue.main.async {
            config.items.forEach { self.onToggle?($0.id, false) }
        }
    }

    // MARK: - Notifications

    private func safe(_ market: String) -> String {
        market.replacingOccurrences(of: "[^A-Za-z0-9]", with: "_", options: .regularExpression)
    }
    private func categoryId(_ market: String) -> String { "EDGE_CHECKLIST.\(safe(market))" }
    private func liveId(_ market: String) -> String { "edge.checklist.\(safe(market)).live" }
    private func scheduledPrefix(_ market: String) -> String { "edge.checklist.\(safe(market)).sched." }

    private static func parseTime(_ value: String) -> (Int, Int) {
        let parts = value.split(separator: ":").compactMap { Int($0) }
        return (min(max(parts.first ?? 9, 0), 23), min(max(parts.count > 1 ? parts[1] : 0, 0), 59))
    }

    private func content(for config: Config, market: String, fresh: Bool) -> UNMutableNotificationContent {
        let items = fresh ? config.items.map { Item(id: $0.id, label: $0.label, checked: false) } : config.items
        let done = items.filter { $0.checked }.count
        let content = UNMutableNotificationContent()
        content.title = "Pre-Trade Checklist — \(config.strategyName)"
        content.subtitle = "\(done)/\(items.count) done · hold to tick"
        content.body = items.map { ($0.checked ? "✅ " : "⬜️ ") + $0.label }.joined(separator: "\n")
        content.categoryIdentifier = categoryId(market)
        content.threadIdentifier = "edge.checklist.\(safe(market))"
        content.userInfo = [Self.marketKey: market]
        return content
    }

    /// Action buttons, one per rule, titled with its current state.
    private func registerCategory(for config: Config, market: String, completion: @escaping () -> Void) {
        var actions = config.items.prefix(Self.maxItems).map { item in
            UNNotificationAction(identifier: Self.toggleActionPrefix + item.id,
                                 title: (item.checked ? "✅ " : "⬜️ ") + item.label,
                                 options: [])
        }
        actions.append(UNNotificationAction(identifier: Self.resetAction, title: "Reset checklist", options: [.destructive]))
        let category = UNNotificationCategory(identifier: categoryId(market), actions: actions,
                                              intentIdentifiers: [], options: [])
        center.getNotificationCategories { existing in
            let others = existing.filter { $0.identifier != category.identifier }
            self.center.setNotificationCategories(others.union([category]))
            completion()
        }
    }

    private func schedule(_ config: Config, market: String) {
        let (hour, minute) = Self.parseTime(config.notificationTime)
        // ISO day (1 = Mon … 7 = Sun) → Calendar weekday (1 = Sun … 7 = Sat).
        let isoDays: [Int]
        switch config.repeatMode {
        case "weekdays": isoDays = [1, 2, 3, 4, 5]
        case "custom": isoDays = config.customDays.filter { (1...7).contains($0) }
        default: isoDays = []   // daily
        }
        let body = content(for: config, market: market, fresh: true)
        body.sound = .default

        var triggers: [(String, DateComponents)] = []
        if isoDays.isEmpty && config.repeatMode != "custom" {
            triggers.append(("daily", DateComponents(hour: hour, minute: minute)))
        } else {
            for iso in Set(isoDays) {
                triggers.append(("d\(iso)", DateComponents(hour: hour, minute: minute, weekday: iso == 7 ? 1 : iso + 1)))
            }
        }
        for (suffix, components) in triggers {
            let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: true)
            center.add(UNNotificationRequest(identifier: scheduledPrefix(market) + suffix, content: body, trigger: trigger))
        }
    }

    /// Shows (or replaces) the visible checklist. The identifier is fixed, so
    /// each tick replaces the previous copy instead of stacking new ones.
    private func postLive(_ config: Config, market: String, withSound: Bool) {
        let body = content(for: config, market: market, fresh: false)
        if withSound { body.sound = .default }
        center.add(UNNotificationRequest(identifier: liveId(market), content: body, trigger: nil))
    }

    private func refreshLiveIfShown(_ config: Config, market: String) {
        let id = liveId(market)
        center.getDeliveredNotifications { delivered in
            guard delivered.contains(where: { $0.request.identifier == id }), config.enabled else { return }
            self.registerCategory(for: config, market: market) {
                self.postLive(config, market: market, withSound: false)
            }
        }
    }

    private func removeAll(market: String, completion: @escaping () -> Void) {
        let prefix = scheduledPrefix(market)
        center.getPendingNotificationRequests { pending in
            let ids = pending.map { $0.identifier }.filter { $0.hasPrefix(prefix) }
            self.center.removePendingNotificationRequests(withIdentifiers: ids)
            self.center.removeDeliveredNotifications(withIdentifiers: [self.liveId(market)])
            completion()
        }
    }

    // MARK: - Response handling

    private func isChecklist(_ notification: UNNotification) -> Bool {
        notification.request.content.categoryIdentifier.hasPrefix("EDGE_CHECKLIST.")
    }

    /// Returns true if the response was a checklist action and was handled.
    @discardableResult
    func handle(_ response: UNNotificationResponse) -> Bool {
        guard isChecklist(response.notification),
              let market = response.notification.request.content.userInfo[Self.marketKey] as? String else { return false }
        let action = response.actionIdentifier
        if action.hasPrefix(Self.toggleActionPrefix) {
            toggle(itemId: String(action.dropFirst(Self.toggleActionPrefix.count)), market: market)
        } else if action == Self.resetAction {
            resetTicks(market: market)
        }
        // A plain tap opens the app on the checklist screen; nothing to change here.
        return true
    }

    /// Called once the Capacitor bridge exists. Anything that arrived before it
    /// (a push tapped on a cold launch) is handed to Capacitor now.
    func attach(router: NotificationRouter) {
        self.router = router
        let pending = pendingForeignResponses
        pendingForeignResponses.removeAll()
        pending.forEach { router.userNotificationCenter(center, didReceive: $0, withCompletionHandler: {}) }
    }

    // NotificationHandlerProtocol — Capacitor's router forwards local notifications here.
    func willPresent(notification: UNNotification) -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    func didReceive(response: UNNotificationResponse) {
        handle(response)
    }

    // UNUserNotificationCenterDelegate — only active until the bridge's router takes over.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        if !handle(response) {
            if let router = router {
                router.userNotificationCenter(center, didReceive: response, withCompletionHandler: {})
            } else {
                pendingForeignResponses.append(response)
            }
        }
        completionHandler()
    }
}
