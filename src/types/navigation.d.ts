// src/types/navigation.d.ts
import type { RootStackParamList as LocalStack } from './navigation';

declare global {
  namespace ReactNavigation {
    // Merge your explicit routes with a permissive catch-all so
    // `navigate('Whatever')` doesn’t become `never`.
    interface RootParamList
      extends Record<string, object | undefined>,
        LocalStack {}
  }
}

export {};
