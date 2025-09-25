// src/lib/env.ts
// Google Places helpers (autocomplete + details) with safe env + fallbacks.

import { GOOGLE_PLACES_KEY, PLACES_COUNTRIES } from '@config/env';

export type PlaceSuggestion = { description: string; place_id: string };

const AC_URL = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
const DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';

const DEFAULT_TIMEOUT_MS = 8000;

/** Build components=country:us|country:ca from a list of 2‑letter codes */
function buildComponentsParam(codes: string[] | undefined): string | undefined {
  if (!codes?.length) return undefined;
  const list = codes
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)
    .map((c) => (c.length === 2 ? c : '')); // keep only ISO‑2
  const parts = list.filter(Boolean).map((c) => `country:${c}`);
  return parts.length ? parts.join('|') : undefined;
}

function buildUrl(
  base: string,
  params: Record<string, string | number | undefined>
): string {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.append(k, String(v));
  });
  return `${base}?${p.toString()}`;
}

async function getJSON<T>(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    // Google Places returns 200 with error codes in JSON; still parse body.
    return (await res.json()) as T;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Try autocomplete with types=(cities), then (regions), then no types.
 * Uses EXPO_PUBLIC_GOOGLE_API_KEY from @config/env.
 */
export async function fetchPlaceSuggestions(
  input: string,
  sessionToken: string,
  opts?: {
    language?: string;
    components?: string; // e.g. "country:us|country:ca"
    timeoutMs?: number;
  }
): Promise<PlaceSuggestion[]> {
  if (!GOOGLE_PLACES_KEY || !input?.trim()) return [];

  const components =
    opts?.components ?? buildComponentsParam(PLACES_COUNTRIES);

  const baseParams = {
    input: input.trim(),
    key: GOOGLE_PLACES_KEY,
    sessiontoken: sessionToken,
    language: opts?.language,
    components,
  };

  const tries: Array<Record<string, string | undefined>> = [
    { types: '(cities)' },
    { types: '(regions)' },
    {}, // no type filter
  ];

  for (const extra of tries) {
    try {
      const url = buildUrl(AC_URL, { ...baseParams, ...extra });
      const json = await getJSON<any>(url, opts?.timeoutMs);

      if (json?.status === 'OK' && Array.isArray(json?.predictions) && json.predictions.length) {
        return json.predictions.map((p: any) => ({
          description: p.description,
          place_id: p.place_id,
        }));
      }

      // Statuses like ZERO_RESULTS, OVER_QUERY_LIMIT, REQUEST_DENIED
      if (json?.status && json.status !== 'ZERO_RESULTS') {
        console.warn('[Places autocomplete]', json.status, json.error_message || '');
      }
      // fall through to next try
    } catch (e) {
      console.warn('[Places autocomplete] fetch failed:', String(e));
      // try next strategy
    }
  }

  return [];
}

export async function fetchPlaceDetails(
  placeId: string,
  sessionToken: string,
  opts?: { language?: string; timeoutMs?: number }
): Promise<{ lat: number; lng: number; name?: string } | null> {
  if (!GOOGLE_PLACES_KEY || !placeId) return null;

  const url = buildUrl(DETAILS_URL, {
    place_id: placeId,
    fields: 'geometry,name',
    key: GOOGLE_PLACES_KEY,
    sessiontoken: sessionToken,
    language: opts?.language,
  });

  try {
    const json = await getJSON<any>(url, opts?.timeoutMs);
    if (json?.status === 'OK' && json?.result?.geometry?.location) {
      const { lat, lng } = json.result.geometry.location;
      return { lat, lng, name: json.result.name };
    }
    console.warn('[Places details]', json?.status, json?.error_message || '');
    return null;
  } catch (e) {
    console.warn('[Places details] fetch failed:', String(e));
    return null;
  }
}

/** Quick runtime flag to gate features */
export const PLACES_AVAILABLE = !!GOOGLE_PLACES_KEY;
