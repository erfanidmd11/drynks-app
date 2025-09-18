// src/boot/UltraSafeBoot.tsx

import React, { useEffect, useState } from 'react';
import { AppState, InteractionManager, Platform } from 'react-native';

const IMPORT_DELAY = Platform.OS === 'ios' ? 700 : 150;
const ACTIVE_TIMEOUT = 2500;
const FRAME_TIMEOUT = 1000;

const LazyApp = React.lazy(() =>
  new Promise<{ default: React.ComponentType<any> }>(async (resolve) => {
    await new Promise((res) => setTimeout(res, IMPORT_DELAY));
    const mod = await import('../navigation/AppNavigator');

    // ✅ Use only the default export
    resolve({ default: mod.default });
  })
);

async function waitActiveAndFirstFrame() {
  const waitActive = new Promise<void>((resolve) => {
    if (AppState.currentState === 'active') return resolve();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        try {
          sub.remove();
        } catch {}
        resolve();
      }
    });
  });

  const waitFrame = new Promise<void>((resolve) => {
    InteractionManager.runAfterInteractions(() => resolve());
  });

  await Promise.race([waitActive, new Promise((res) => setTimeout(res, ACTIVE_TIMEOUT))]);
  await Promise.race([waitFrame, new Promise((res) => setTimeout(res, FRAME_TIMEOUT))]);

  if (Platform.OS === 'ios') {
    await new Promise((res) => setTimeout(res, 120));
  }
}

export default function UltraSafeBoot() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      await waitActiveAndFirstFrame();
      if (!cancelled) setReady(true);
    };

    void initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) return null;

  return (
    <React.Suspense fallback={null}>
      <LazyApp />
    </React.Suspense>
  );
}
