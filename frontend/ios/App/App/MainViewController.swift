import UIKit
import Capacitor

/**
 Host view controller for the Capacitor WebView.

 Exists for one reason: to register the app-target native plugins. Capacitor 6
 auto-registers only the classes listed in capacitor.config.json's
 packageClassList, which `cap sync` fills from installed npm plugins. A plugin
 that lives in the App target — as EdgeAuthStorage does, matching the Android
 side where MainActivity calls registerPlugin(EdgeAuthStoragePlugin.class) — is
 invisible to that list and has to be registered by hand.

 Main.storyboard points its only scene at this class instead of
 CAPBridgeViewController. If that link is ever lost, the bridge still boots but
 window.Capacitor.Plugins.EdgeAuthStorage is undefined, and iOS silently falls
 back to @capacitor/preferences (see utils/authStorage.js) — which is persistence
 but not the Keychain. scripts/check-mobile-auth-storage.js guards the wiring.
 */
class MainViewController: CAPBridgeViewController {

    /// Called by CAPBridgeViewController once `bridge` and `webView` exist and
    /// before the first page load, so the plugin is on the bridge by the time
    /// any JS runs.
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        // registerPluginInstance, not registerPluginType: the latter is a no-op
        // while autoRegisterPlugins is on, which it is by default.
        bridge?.registerPluginInstance(EdgeAuthStoragePlugin())
    }
}
