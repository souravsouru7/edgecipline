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
      skipNativeAuth: false,
      providers: ['google.com'],
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
