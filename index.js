import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// Register for Bare React Native Android
AppRegistry.registerComponent(appName, () => App);

// Register for Expo Go, Dev Client and Web
registerRootComponent(App);
