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
    extra: {
      eas: {
        projectId: 'b705caab-bcce-4c94-b4f1-e844cf2f67f4',
      },
    },
  },
};
