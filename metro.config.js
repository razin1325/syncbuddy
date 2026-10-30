// Learn more https://docs.expo.dev/guides/customizing-metro
let getDefaultConfig;
try {
  getDefaultConfig = require('expo/metro-config').getDefaultConfig;
} catch {
  getDefaultConfig = require('@react-native/metro-config').getDefaultConfig;
}

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

module.exports = config;
