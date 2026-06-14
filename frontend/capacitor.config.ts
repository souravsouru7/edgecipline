import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.edgecpline',
  appName: 'Edgecipline',
  webDir: 'out',
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#F4F2EE',
      showSpinner: false,
      launchFadeOutDuration: 200,
    },
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
