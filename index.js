import { Platform, AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

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
