module.exports = function(api) {
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
            "@assets": "./assets"
          }
        }
      ]
    ]
  };
};
