import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';

const SUPABASE_REMOTE_URL = 'https://nxjhygndibrmapwofvcs.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_75cj42cz40b7Qgox5_XwAw_5nrcfKUQ';

/**
 * Supabase base URL.
 *
 * - **Default (browser + APK):** connect directly to `*.supabase.co`.
 *   The Python static server (`app.py`) proxies `/supabase-api/*` over HTTP only — it
 *   cannot upgrade WebSockets, so Realtime (`wss://.../supabase-api/realtime/...`)
 *   always fails and the console floods with errors.
 * - **Optional proxy:** set `VITE_USE_SUPABASE_PROXY=true` (e.g. WeChat in-app
 *   browser that blocks cross-origin). Dev server (`vite.config.ts`) still supports
 *   WS via proxy when you enable this flag locally.
 */
function resolveSupabaseUrl(): string {
  if (typeof window === 'undefined') {
    return SUPABASE_REMOTE_URL;
  }
  if (Capacitor.isNativePlatform()) {
    return SUPABASE_REMOTE_URL;
  }
  if (import.meta.env.VITE_USE_SUPABASE_PROXY === 'true') {
    return `${window.location.protocol}//${window.location.host}/supabase-api`;
  }
  return SUPABASE_REMOTE_URL;
}

const SUPABASE_URL = resolveSupabaseUrl();

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    fetch: (...args) => fetch(...args),
  },
});
