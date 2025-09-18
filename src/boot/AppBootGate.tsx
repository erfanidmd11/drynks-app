// src/boot/AppBootGate.tsx

import React, { useEffect } from 'react';
import { AppState, AppStateStatus, InteractionManager } from 'react-native';

import { unlockEmitters } from './SafeEmitterShim';

export default function AppBootGate({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let cancelled = false;

    const unlockWhenReady = async () => {
      // Wait for app to be active
      if (AppState.currentState !== 'active') {
        await new Promise<void>((resolve) => {
          const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
            if (s === 'active') {
              try {
                sub.remove();
              } catch {}
              resolve();
            }
          });
        });
      }

      // Wait for JS event loop to be idle
      await new Promise<void>((resolve) =>
        InteractionManager.runAfterInteractions(() => resolve())
      );

      if (!cancelled) {
        try {
          unlockEmitters(); // 🔓 Enables `addListener/removeListeners` on TurboModules
        } catch (err) {
          console.warn('[AppBootGate] unlockEmitters failed:', err);
        }
      }
    };

    void unlockWhenReady();

    return () => {
      cancelled = true;
    };
  }, []);

  return <>{children}</>;
}
