module.exports = ({ config }) => ({
  ...config,
  name: 'SyncBuddy',
  slug: 'syncbuddy',
  version: '1.0.0',
  web: {
    bundler: 'metro',
    output: 'single',
  },
});
