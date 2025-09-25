// babel.config.js
module.exports = function (api) {
  // Treat EAS builds as production and cache per mode
  const isProd =
    process.env.NODE_ENV === 'production' ||
    process.env.APP_ENV === 'production' ||
    process.env.EAS_BUILD === 'true';

  // Cache based on mode so changes to NODE_ENV/EAS_BUILD re-evaluate
  api.cache.using(() => (isProd ? 'prod' : 'dev'));

  const plugins = [
    // Path aliases — keep in sync with tsconfig.json "paths"
    [
      'module-resolver',
      {
        root: ['./'],
        extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
        alias: {
          '@': './src',
          '@assets': './assets',
          '@components': './src/components',
          '@config': './src/config',
          '@hooks': './src/hooks',
          '@navigation': './src/navigation',
          '@screens': './src/screens',
          '@services': './src/services',
          '@state': './src/state',
          '@types': './types',
          '@utils': './src/utils',
        },
      },
    ],

    // import { SUPABASE_URL } from '@env'
    // (inlines variables at build time; allowUndefined prevents hard failures in dev/Go)
    [
      'dotenv-import',
      {
        moduleName: '@env',
        path: '.env',
        safe: false,
        allowUndefined: true,
      },
    ],
  ];

  // Strip console.* in production/EAS builds (keep warn/error)
  if (isProd) {
    plugins.push(['transform-remove-console', { exclude: ['error', 'warn'] }]);
  }

  // ⚠️ MUST be last for Reanimated v3+
  plugins.push('react-native-reanimated/plugin');

  return {
    presets: ['babel-preset-expo'],
    plugins,
    compact: isProd, // Metro also minifies, but this is fine
  };
};
