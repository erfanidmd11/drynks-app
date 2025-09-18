// babel.config.js
module.exports = function (api) {
  // Decide "prod" without relying solely on api.env
  const isProd =
    process.env.NODE_ENV === 'production' ||
    process.env.APP_ENV === 'production' ||
    process.env.EAS_BUILD === 'true';

  // Cache by our explicit env flag (forces rebuild when you change it)
  api.cache.using(() => (isProd ? 'prod' : 'dev'));

  const plugins = [
    // Path aliases (must match your tsconfig.json "paths" if you use TypeScript)
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
      {
        moduleName: '@env',
        path: '.env',
        safe: false,
        allowUndefined: true,
      },
    ],
  ];

  // Strip console.* in production, but keep warn/error
  if (isProd) {
    plugins.push(['transform-remove-console', { exclude: ['error', 'warn'] }]);
  }

  // Reanimated plugin MUST be last
  try {
    require.resolve('react-native-reanimated/plugin');
    plugins.push('react-native-reanimated/plugin');
  } catch {
    // plugin not installed — skip (useful for web-only builds or CI)
  }

  return {
    presets: ['babel-preset-expo'],
    plugins,
  };
};
