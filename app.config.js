module.exports = ({ config }) => ({
  ...config,
  name: 'SyncBuddy',
  slug: 'syncbuddy',
  version: '1.0.0',
  web: {
    bundler: 'metro',
    output: 'single',
  },
  extra: {
    eas: {
      projectId: '2f4cf941-fcce-4cf5-a627-9f8d9b8a9681',
    },
  },
});
