// src/types/shims.d.ts

// --- 3rd-party libs without @types ---
declare module 'base-64' {
  export function encode(s: string): string;
  export function decode(s: string): string;
}

declare module 'tz-lookup' {
  export default function tzlookup(lat: number, lon: number): string;
}

// --- Static asset modules (optional but handy) ---
declare module '*.png';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.svg' {
  const c: any;
  export default c;
}

// ⚠️ DO NOT put a ReactNavigation global here.
// We already merge navigation types in src/types/navigation.d.ts
