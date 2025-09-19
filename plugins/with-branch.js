// plugins/with-branch.js
// Branch deep link config plugin for Expo (CommonJS)
// - Uses 'expo/config-plugins' (NOT '@expo/config-plugins')
// - Writes Branch keys to Info.plist
// - Adds sanitized Associated Domains to entitlements
// - Sets Android <meta-data> keys

const { withInfoPlist, withEntitlementsPlist, withAndroidManifest } = require('expo/config-plugins');

function unique(arr) {
  return Array.from(new Set(arr));
}

const sanitizeDomain = (d) => {
  if (!d) return null;
  let host = String(d).trim();
  host = host.replace(/^https?:\/\//i, ''); // strip protocol
  host = host.split('/')[0];                // strip path
  host = host.split('?')[0];                // strip query
  return host || null;
};

function setMeta(app, name, value) {
  if (!value) return;
  app['meta-data'] = app['meta-data'] || [];
  const existing = app['meta-data'].find((m) => m.$?.['android:name'] === name);
  if (existing) {
    existing.$['android:value'] = value;
  } else {
    app['meta-data'].push({ $: { 'android:name': name, 'android:value': value } });
  }
}

function withBranch(config, props = {}) {
  const liveKey = props.liveKey ?? process.env.BRANCH_KEY_LIVE ?? '';
  const testKey = props.testKey ?? process.env.BRANCH_KEY_TEST ?? '';
  const rawDomains = props.domains ?? ['dr-ynks.app.link', 'dr-ynks-alternate.app.link'];

  const domains = unique(rawDomains.map(sanitizeDomain).filter(Boolean));

  // iOS: Info.plist (Branch keys + optional helper array)
  config = withInfoPlist(config, (cfg) => {
    const plist = cfg.modResults;

    if (liveKey || testKey) {
      plist.branch_key = plist.branch_key || {};
      if (liveKey) plist.branch_key.live = liveKey;
      if (testKey) plist.branch_key.test = testKey;
    }

    // Optional helper array some SDKs check
    if (domains.length) {
      const existing = Array.isArray(plist.branch_universal_link_domains)
        ? plist.branch_universal_link_domains
        : [];
      plist.branch_universal_link_domains = unique([...existing, ...domains]);
    }
    return cfg;
  });

  // iOS: Entitlements (Associated Domains)
  config = withEntitlementsPlist(config, (cfg) => {
    const ent = cfg.modResults;
    const existing = Array.isArray(ent['com.apple.developer.associated-domains'])
      ? ent['com.apple.developer.associated-domains']
      : [];
    const toAdd = domains.map((d) => `applinks:${d}`);
    ent['com.apple.developer.associated-domains'] = unique([...existing, ...toAdd]);
    return cfg;
  });

  // Android: <meta-data> keys
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const app = manifest?.manifest?.application?.[0];
    if (app) {
      if (liveKey) setMeta(app, 'io.branch.sdk.BranchKey', liveKey);
      if (testKey) setMeta(app, 'io.branch.sdk.BranchKey.test', testKey);
      // Optional: force test mode
      // setMeta(app, 'io.branch.sdk.TestMode', 'true');
    }
    return cfg;
  });

  return config;
}

module.exports = withBranch;
