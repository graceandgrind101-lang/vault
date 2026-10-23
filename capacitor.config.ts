import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kryptonvault.zeroknowledge',
  appName: 'Krypton Vault',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    backgroundColor: '#070b14',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#070b14',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    PrivacyScreen: {
      enable: true,
      imageName: 'Splash',
      contentMode: 'scaleAspectFill',
      preventScreenshots: true,
    },
    BiometricAuth: {
      allowDeviceCredential: true,
      androidTitle: 'Krypton Vault Hardware Unlock',
      androidSubtitle: 'Authenticate via Fingerprint or Face Unlock to decrypt AES-256-GCM Keystore',
    },
  },
};

export default config;
