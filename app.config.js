module.exports = {
  expo: {
    name: 'SyncBuddy',
    slug: 'syncbuddy',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    android: {
      package: 'com.syncbuddy',
      adaptiveIcon: {
        backgroundColor: '#080B12',
      },
    },
    web: {
      bundler: 'metro',
      output: 'single',
    },
  },
};
