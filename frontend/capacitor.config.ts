import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.edgecpline',
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
  },
};

export default config;
