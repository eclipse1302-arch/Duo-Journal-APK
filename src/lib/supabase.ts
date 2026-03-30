import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';

const SUPABASE_REMOTE_URL = 'https://nxjhygndibrmapwofvcs.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_75cj42cz40b7Qgox5_XwAw_5nrcfKUQ';

// Default to direct Supabase on web to avoid server-side proxy timeouts.
// If you truly need same-origin proxy in restricted webviews, set:
//   VITE_USE_SUPABASE_PROXY=true
function resolveSupabaseUrl(): string {
  if (typeof window === 'undefined') return SUPABASE_REMOTE_URL;
  if (Capacitor.isNativePlatform()) return SUPABASE_REMOTE_URL;
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
