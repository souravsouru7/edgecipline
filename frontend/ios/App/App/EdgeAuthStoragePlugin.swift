import Foundation
import Capacitor
import Security

/**
 iOS counterpart of `android/app/src/main/java/com/edgecipline/EdgeAuthStoragePlugin.java`.

 Same plugin name, same method names, same JS payloads, so `utils/authStorage.js`
 drives one code path on both platforms:

     set({ key, value })  -> resolve()
     get({ key })         -> resolve({ value: String | null })
     remove({ key })      -> resolve()
     clear()              -> resolve()

 Where Android encrypts with an Android Keystore AES-GCM key and stores the
 envelope in SharedPreferences, iOS hands the value straight to the Keychain —
 the Keychain already owns the encryption, so there is nothing to wrap.

 Accessibility is `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`:

   - AfterFirstUnlock, not WhenUnlocked, because a silent token refresh can run
     while the device is locked (background push, app resumed into a locked
     screen). WhenUnlocked would fail those reads and look like a lost session.
   - ThisDeviceOnly so the access token is excluded from iCloud Keychain sync
     and from device backups. A bearer token is device state, not user data; it
     must not be restorable onto another handset.

 This class is registered explicitly by `MainViewController.capacitorDidLoad()`.
 Capacitor 6 auto-registers only the plugins listed in capacitor.config.json's
 packageClassList (npm packages), so an app-target plugin has to say so itself.

 No token value is ever logged here; failures are reported as OSStatus codes.
 */
@objc(EdgeAuthStoragePlugin)
public class EdgeAuthStoragePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EdgeAuthStoragePlugin"
    public let jsName = "EdgeAuthStorage"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    /// Namespaces these items so they cannot collide with any other keychain
    /// item the app or its SDKs store. Changing this string orphans every
    /// already-stored token, which signs every installed user out.
    private static let service = "com.edgecipline.auth"

    private func baseQuery(for key: String) -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: EdgeAuthStoragePlugin.service,
            kSecAttrAccount as String: key
        ]
    }

    // MARK: - set

    @objc func set(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.trimmingCharacters(in: .whitespaces).isEmpty else {
            call.reject("Missing key")
            return
        }
        guard let value = call.getString("value") else {
            call.reject("Missing value")
            return
        }
        guard let data = value.data(using: .utf8) else {
            call.reject("Secure storage write failed")
            return
        }

        var query = baseQuery(for: key)

        // SecItemAdd fails with errSecDuplicateItem rather than overwriting, so
        // an update of an existing token is an update, not an add. Attributes
        // are re-applied on update too: an item written by an older build with
        // different accessibility must not keep it.
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]

        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)

        if status == errSecItemNotFound {
            query[kSecValueData as String] = data
            query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(query as CFDictionary, nil)
        }

        guard status == errSecSuccess else {
            CAPLog.print("⚡️ EdgeAuthStorage: set failed, OSStatus \(status)")
            call.reject("Secure storage write failed")
            return
        }

        call.resolve()
    }

    // MARK: - get

    @objc func get(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.trimmingCharacters(in: .whitespaces).isEmpty else {
            call.reject("Missing key")
            return
        }

        var query = baseQuery(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        // "Nothing stored" is a normal signed-out state, not an error. Resolving
        // with an explicit null keeps it distinguishable from a read that failed.
        if status == errSecItemNotFound {
            call.resolve(["value": NSNull()])
            return
        }

        guard status == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8) else {
            // Mirrors the Android plugin: never delete the stored item because a
            // read failed. errSecInteractionNotAllowed in particular is
            // transient (device locked before first unlock after reboot), and
            // deleting on it would turn a temporary error into a permanent
            // logout. The JS layer retries, then falls back to the refresh cookie.
            CAPLog.print("⚡️ EdgeAuthStorage: get failed, OSStatus \(status)")
            call.reject("Secure storage read temporarily unavailable")
            return
        }

        call.resolve(["value": value])
    }

    // MARK: - remove

    @objc func remove(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.trimmingCharacters(in: .whitespaces).isEmpty else {
            call.reject("Missing key")
            return
        }

        let status = SecItemDelete(baseQuery(for: key) as CFDictionary)

        // Already gone is the outcome the caller wanted.
        guard status == errSecSuccess || status == errSecItemNotFound else {
            CAPLog.print("⚡️ EdgeAuthStorage: remove failed, OSStatus \(status)")
            call.reject("Secure storage remove failed")
            return
        }

        call.resolve()
    }

    // MARK: - clear

    @objc func clear(_ call: CAPPluginCall) {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: EdgeAuthStoragePlugin.service
        ]
        // Scoped to this service only — never a blanket keychain wipe.
        query[kSecAttrSynchronizable as String] = kSecAttrSynchronizableAny

        let status = SecItemDelete(query as CFDictionary)

        guard status == errSecSuccess || status == errSecItemNotFound else {
            CAPLog.print("⚡️ EdgeAuthStorage: clear failed, OSStatus \(status)")
            call.reject("Secure storage clear failed")
            return
        }

        call.resolve()
    }
}
