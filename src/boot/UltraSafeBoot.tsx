import React, { useEffect, useState } from 'react';
import { AppState, InteractionManager, Platform } from 'react-native';

const IMPORT_DELAY = Platform.OS === 'ios' ? 700 : 150;
const ACTIVE_TIMEOUT = 2500; // safety: never wait forever
const FRAME_TIMEOUT = 1000;

const LazyApp = React.lazy(async () => {
  // Defer hitting the module graph at all
  await new Promise<void>((r) => setTimeout(r, IMPORT_DELAY));
  const mod = await import('../navigation/AppNavigator');
  return { default: (mod as any).default ?? mod } as { default: React.ComponentType<any> };
});

async function waitActiveAndFirstFrame() {
  const waitActive = new Promise<void>((resolve) => {
    if (AppState.currentState === 'active') return resolve();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        try { sub.remove(); } catch {}
        resolve();
      }
    });
  });

  const waitFrame = new Promise<void>((resolve) =>
    InteractionManager.runAfterInteractions(() => resolve())
  );

  // Guard both waits with timeouts so UI never stalls
  await Promise.race([waitActive, new Promise<void>((r) => setTimeout(r, ACTIVE_TIMEOUT))]);
  await Promise.race([waitFrame, new Promise<void>((r) => setTimeout(r, FRAME_TIMEOUT))]);

  if (Platform.OS === 'ios') {
    // Let navigation settle a touch more on iOS
    await new Promise<void>((r) => setTimeout(r, 120));
  }
}

export default function UltraSafeBoot() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await waitActiveAndFirstFrame();
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  if (!ready) return null;

  return (
    <React.Suspense fallback={null}>
      <LazyApp />
    </React.Suspense>
  );
}
