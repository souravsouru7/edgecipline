import UIKit
import Capacitor

// Apps built with the iOS 27 SDK must adopt the UIScene life cycle or UIKit
// refuses to launch them. The window is created from Main.storyboard via
// UIApplicationSceneManifest in Info.plist.
//
// Under scenes UIKit stops calling the AppDelegate URL / user-activity
// callbacks, so they are forwarded to Capacitor here instead — otherwise the
// App plugin's appUrlOpen (deep links, the Google Sign-In redirect) never fires.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // Cold launch from a link: the callbacks below don't fire for these.
        if let url = connectionOptions.urlContexts.first?.url {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
        }
        if let userActivity = connectionOptions.userActivities.first {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: [:])
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }
}
