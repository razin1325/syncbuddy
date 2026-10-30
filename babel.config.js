module.exports = function (api) {
  api.cache(true);
  try {
    require.resolve('babel-preset-expo');
    return {
      presets: ['babel-preset-expo'],
    };
  } catch {
    return {
      presets: ['module:@react-native/babel-preset'],
    };
  }
};
