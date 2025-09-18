// src/types/navigation.d.ts
import type { RootStackParamList } from './navigation';

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

export {};
