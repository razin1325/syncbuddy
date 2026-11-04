import { Platform, AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// Global error handler to prevent sudden app crashes in production release builds
if (typeof global !== 'undefined' && global.ErrorUtils) {
  const originalHandler = global.ErrorUtils.getGlobalHandler();
  global.ErrorUtils.setGlobalHandler((error, isFatal) => {
    console.error('Captured Global JS Exception:', error);
    if (__DEV__ && originalHandler) {
      originalHandler(error, isFatal);
    }
  });
}

// Register for Bare React Native Android
AppRegistry.registerComponent(appName, () => App);
AppRegistry.registerComponent('main', () => App);

// Register for Expo Web preview
if (Platform.OS === 'web') {
  try {
    const { registerRootComponent } = require('expo');
    registerRootComponent(App);
  } catch (e) {
    // web fallback
  }
}

