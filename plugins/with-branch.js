// plugins/with-branch.js
// Branch deep link config plugin for Expo (CommonJS)
// - Uses 'expo/config-plugins' (NOT '@expo/config-plugins')
// - Writes Branch keys to iOS Info.plist
// - Adds sanitized Associated Domains to iOS entitlements
// - Sets Android <meta-data> keys and TestMode toggle (live/test)
// - Respects BRANCH_USE_TEST (1/true) to make the TEST key primary on Android

const {
  withInfoPlist,
  withEntitlementsPlist,
  withAndroidManifest,
  createRunOncePlugin,
} = require('expo/config-plugins');

const PKG = { name: 'with-branch', version: '1.1.0' };

/** Deduplicate array values. */
function unique(arr) {
  return Array.from(new Set(arr));
}

/** Parse a domain/URL into a plain host, stripping protocol, path, query, and any 'applinks:' prefix. */
function sanitizeDomain(d) {
  if (!d) return null;
  let host = String(d).trim();
  host = host.replace(/^applinks:/i, '');      // strip applinks: prefix if provided
  host = host.replace(/^https?:\/\//i, '');    // strip protocol
  host = host.split('/')[0];                   // strip path
  host = host.split('?')[0];                   // strip query
  host = host.replace(/\.$/, '');              // strip trailing dot
  return host || null;
}

/** Idempotently set or update a <meta-data> entry in AndroidManifest. */
function setMeta(app, name, value) {
  if (value == null) return;
  const str = String(value);
  if (!str.length) return;

  app['meta-data'] = app['meta-data'] || [];
  const items = app['meta-data'];
  const existing = items.find((m) => m.$ && m.$['android:name'] === name);

  if (existing) {
    existing.$['android:value'] = str;
  } else {
    items.push({ $: { 'android:name': name, 'android:value': str } });
  }
}

/** Coerce env/prop into boolean: true for 1,true,yes,on,test (case-insensitive). */
function parseBool(input, fallback = false) {
  if (typeof input === 'boolean') return input;
  if (input == null) return fallback;
  return /^(1|true|yes|on|test)$/i.test(String(input).trim());
}

function withBranch(config, props = {}) {
  // Resolve keys from props or env (EAS secrets recommended).
  const liveKey = (props.liveKey ?? process.env.BRANCH_KEY_LIVE ?? '').trim();
  const testKey = (props.testKey ?? process.env.BRANCH_KEY_TEST ?? '').trim();

  // Toggle test/live behavior (primarily affects Android runtime selection).
  const useTestInstance = parseBool(
    props.useTestInstance ?? process.env.BRANCH_USE_TEST,
    false
  );

  // Default Branch domains for both live and test (plus alternate).
  const rawDomains =
    props.domains ??
    [
      'dr-ynks.app.link',
      'dr-ynks-alternate.app.link',
      'dr-ynks.test-app.link',
      'dr-ynks-alternate.test-app.link',
    ];

  const domains = unique(rawDomains.map(sanitizeDomain).filter(Boolean));

  // --- iOS: Info.plist -------------------------------------------------------
  config = withInfoPlist(config, (cfg) => {
    const plist = cfg.modResults;

    // Branch iOS keys: { branch_key: { live, test } }
    if (liveKey || testKey) {
      plist.branch_key = plist.branch_key || {};
      if (liveKey) plist.branch_key.live = liveKey;
      if (testKey) plist.branch_key.test = testKey;
    }

    // Optional helper array some SDKs check for Universal Links.
    if (domains.length) {
      const existing = Array.isArray(plist.branch_universal_link_domains)
        ? plist.branch_universal_link_domains
        : [];
      plist.branch_universal_link_domains = unique([...existing, ...domains]);
    }

    return cfg;
  });

  // --- iOS: Entitlements (Associated Domains) --------------------------------
  config = withEntitlementsPlist(config, (cfg) => {
    const ent = cfg.modResults;
    const existing = Array.isArray(ent['com.apple.developer.associated-domains'])
      ? ent['com.apple.developer.associated-domains']
      : [];

    const toAdd = domains.map((d) => `applinks:${d}`);
    ent['com.apple.developer.associated-domains'] = unique([...existing, ...toAdd]);

    return cfg;
  });

  // --- Android: AndroidManifest <meta-data> ----------------------------------
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const app = manifest?.manifest?.application?.[0];
    if (!app) return cfg;

    // Primary key selection:
    // - If useTestInstance=true AND testKey present: primary = testKey
    // - Else if liveKey present: primary = liveKey
    // - Else if only testKey present: primary = testKey (last resort)
    const primaryKey =
      (useTestInstance && testKey) ? testKey :
      (liveKey || testKey || '');

    if (primaryKey) setMeta(app, 'io.branch.sdk.BranchKey', primaryKey);

    // Always set the explicit test key if provided (helps Branch detect both).
    if (testKey) setMeta(app, 'io.branch.sdk.BranchKey.test', testKey);

    // Explicitly set TestMode to mirror BRANCH_USE_TEST.
    setMeta(app, 'io.branch.sdk.TestMode', useTestInstance ? 'true' : 'false');

    return cfg;
  });

  return config;
}

// Ensure the plugin only runs once even if listed multiple times.
module.exports = createRunOncePlugin(withBranch, PKG.name, PKG.version);
