// babel.config.js
module.exports = function (api) {
  // Decide "prod" without relying on api.env (avoids cache funkiness)
  const isProd =
    process.env.NODE_ENV === 'production' ||
    process.env.APP_ENV === 'production' ||
    process.env.EAS_BUILD === 'true';

  // Cache by our explicit env flag
  api.cache.using(() => (isProd ? 'prod' : 'dev'));

  const plugins = [
    // TS path aliases
    [
      'module-resolver',
      {
        root: ['./'],
        extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
        alias: {
          '@components': './src/components',
          '@screens': './src/screens',
          '@config': './src/config',
          '@utils': './src/utils',
          '@assets': './assets',
          '@hooks': './src/hooks',
          '@services': './src/services',
          '@navigation': './src/navigation',
          '@state': './src/state',
          '@types': './types',
        },
      },
    ],

    // import { SUPABASE_URL } from '@env'
    [
      'dotenv-import',
      { moduleName: '@env', path: '.env', safe: false, allowUndefined: true },
    ],
  ];

  // Strip console.* in prod (keep warn/error)
  if (isProd) {
    plugins.push(['transform-remove-console', { exclude: ['error', 'warn'] }]);
  }

  // Reanimated plugin MUST be last — add only if installed
  try {
    const reanimatedPlugin = require.resolve('react-native-reanimated/plugin');
    plugins.push(reanimatedPlugin);
  } catch {
    // Reanimated not installed — skip plugin
  }

  return {
    presets: ['babel-preset-expo'],
    plugins,
  };
};
