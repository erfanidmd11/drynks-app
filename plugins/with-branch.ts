// plugins/with-branch.ts
// Branch deep link config plugin for Expo
// - Imports from 'expo/config-plugins' (Doctor-friendly)
// - Sets Branch keys in Info.plist
// - Adds Associated Domains in Entitlements (correct capability)
// - Sanitizes domains (strips protocol and query string)
// - Sets Android application <meta-data> keys

import {
  ConfigPlugin,
  withInfoPlist,
  withEntitlementsPlist,
  withAndroidManifest,
} from 'expo/config-plugins';

type Options = {
  liveKey?: string | null;
  testKey?: string | null;
  domains?: string[];
};

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

const sanitizeDomain = (d?: string | null): string | null => {
  if (!d) return null;
  let host = String(d).trim();
  host = host.replace(/^https?:\/\//i, ''); // remove protocol
  host = host.split('/')[0];                // remove path
  host = host.split('?')[0];                // remove query
  return host || null;
};

const setMeta = (app: any, name: string, value?: string | null) => {
  if (!value) return;
  app['meta-data'] = app['meta-data'] || [];
  const existing = app['meta-data'].find(
    (m: any) => m.$?.['android:name'] === name
  );
  if (existing) {
    existing.$['android:value'] = value;
  } else {
    app['meta-data'].push({
      $: { 'android:name': name, 'android:value': value },
    });
  }
};

const withBranch: ConfigPlugin<Options> = (config, props) => {
  const liveKey = props?.liveKey ?? process.env.BRANCH_KEY_LIVE ?? '';
  const testKey = props?.testKey ?? process.env.BRANCH_KEY_TEST ?? '';
  const rawDomains = props?.domains ?? ['dr-ynks.app.link', 'dr-ynks-alternate.app.link'];

  // Normalize domains: no protocol, no path, no query
  const domains = unique(
    rawDomains
      .map(sanitizeDomain)
      .filter((x): x is string => !!x)
  );

  // iOS: Info.plist — Branch keys + optional SDK helper key
  config = withInfoPlist(config, (cfg) => {
    const plist = cfg.modResults as Record<string, any>;

    // Branch keys
    if (liveKey || testKey) {
      plist.branch_key = plist.branch_key || {};
      if (liveKey) plist.branch_key.live = liveKey;
      if (testKey) plist.branch_key.test = testKey;
    }

    // Optional: Branch SDK reads this array for universal link domains
    if (domains.length) {
      const existing = Array.isArray(plist.branch_universal_link_domains)
        ? plist.branch_universal_link_domains
        : [];
      plist.branch_universal_link_domains = unique([...existing, ...domains]);
    }

    return cfg;
  });

  // iOS: Entitlements — Associated Domains capability (required for Universal Links)
  config = withEntitlementsPlist(config, (cfg) => {
    const ent = cfg.modResults as Record<string, any>;
    const existing = Array.isArray(ent['com.apple.developer.associated-domains'])
      ? ent['com.apple.developer.associated-domains']
      : [];
    const toAdd = domains.map((d) => `applinks:${d}`);
    ent['com.apple.developer.associated-domains'] = unique([...existing, ...toAdd]);
    return cfg;
  });

  // Android: Application <meta-data> for Branch keys
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults as any;
    const app = manifest?.manifest?.application?.[0];
    if (app) {
      if (liveKey) setMeta(app, 'io.branch.sdk.BranchKey', liveKey);
      if (testKey) setMeta(app, 'io.branch.sdk.BranchKey.test', testKey);
      // To force test mode always, uncomment:
      // setMeta(app, 'io.branch.sdk.TestMode', 'true');
    }
    return cfg;
  });

  return config;
};

export default withBranch;
