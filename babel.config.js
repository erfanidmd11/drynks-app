module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          extensions: ['.js', '.jsx', '.ts', '.tsx'],
          alias: {
            "@components": "./src/components",
            "@screens": "./src/screens",
            "@config": "./src/config",
            "@utils": "./src/utils",
            "@assets": "./assets"
          }
        }
      ],
      [
        'dotenv-import',
        {
          moduleName: '@env',
          path: '.env',
          safe: false,
          allowUndefined: true
        }
      ],
      'react-native-reanimated/plugin' // <-- ✅ MUST BE LAST
    ]
  };
};
