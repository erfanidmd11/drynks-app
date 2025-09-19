const { withInfoPlist, withAndroidManifest } = require('@expo/config-plugins');

function setMeta(app, name, value) {
  app['meta-data'] = app['meta-data'] || [];
  const existing = app['meta-data'].find((m) => m.$['android:name'] === name);
  if (existing) {
    existing.$['android:value'] = value;
  } else {
    app['meta-data'].push({ $: { 'android:name': name, 'android:value': value } });
  }
}

module.exports = function withBranch(config, props = {}) {
  const liveKey = props.liveKey || process.env.BRANCH_KEY_LIVE || '';
  const testKey = props.testKey || process.env.BRANCH_KEY_TEST || '';
  const domains = props.domains || ['dr-ynks.app.link', 'dr-ynks-alternate.app.link'];

  // iOS: Info.plist
  config = withInfoPlist(config, (cfg) => {
    const plist = cfg.modResults;
    plist.branch_key = plist.branch_key || {};
    if (liveKey) plist.branch_key.live = liveKey;
    if (testKey) plist.branch_key.test = testKey;

    const existing = Array.isArray(plist.branch_universal_link_domains)
      ? plist.branch_universal_link_domains
      : [];
    plist.branch_universal_link_domains = Array.from(new Set([...existing, ...domains]));
    return cfg;
  });

  // Android: AndroidManifest.xml
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const app = manifest.manifest.application && manifest.manifest.application[0];
    if (app) {
      if (liveKey) setMeta(app, 'io.branch.sdk.BranchKey', liveKey);
      if (testKey) setMeta(app, 'io.branch.sdk.BranchKey.test', testKey);
      // If you ever want to force test mode:
      // setMeta(app, 'io.branch.sdk.TestMode', 'true');
    }
    return cfg;
  });

  return config;
};
