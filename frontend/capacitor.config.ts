import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const config: CapacitorConfig = {
  appId: 'com.edgecipline',
  appName: 'Edgecipline',
  webDir: 'out',
  plugins: {
    // No SplashScreen block here on purpose. @capacitor/splash-screen is not a
    // dependency of this app, so any config under that key is inert — and
    // `launchAutoHide: false` in particular would hang the boot screen forever
    // if the plugin were ever added, because nothing guarantees a hide() call.
    // The boot splash is the AndroidX one: AppTheme.NoActionBarLaunch in
    // styles.xml, dismissed by installSplashScreen() in MainActivity.
    FirebaseAuthentication: {
      // Keep false. The plugin signs into the NATIVE Firebase SDK, but the
      // `firebase` npm package inside the WebView is a separate instance, and
      // the backend only ever accepts a Firebase ID token — so
      // services/firebaseAuth.js re-exchanges every provider credential through
      // the JS SDK. Setting this true would skip the native sign-in that
      // exchange depends on.
      skipNativeAuth: false,
      // Which provider SDKs the plugin loads natively. The only two options this
      // plugin version exposes are this and skipNativeAuth above.
      //
      // apple.com is here for iOS: it is what makes
      // FirebaseAuthentication.signInWithApple() available, and the native Apple
      // sheet additionally needs the "Sign In with Apple" capability on the App
      // ID and Apple enabled in the Firebase console.
      //
      // Harmless on Android, where it only registers Apple's web-flow provider
      // and nothing invokes it — isAppleSignInAvailable() renders the button on
      // native iOS only. Google is unaffected either way.
      //
      // `cap sync` is what copies this into each platform's generated
      // capacitor.config.json, which is the file the device actually reads. A
      // platform that has not been synced since this changed still carries the
      // old list.
      providers: ['google.com', 'apple.com'],
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    // Pair with android:windowSoftInputMode="adjustResize" in the manifest:
    // the WebView body shrinks when the keyboard opens, so 100dvh layouts and
    // the bottom nav move out of the way instead of the page being panned.
    Keyboard: {
      resize: KeyboardResize.Body,
      resizeOnFullScreen: true,
    },
  },
};

export default config;
