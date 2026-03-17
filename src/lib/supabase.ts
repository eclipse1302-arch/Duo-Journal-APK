import { createClient } from '@supabase/supabase-js';

const SUPABASE_REMOTE_URL = 'https://nxjhygndibrmapwofvcs.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_75cj42cz40b7Qgox5_XwAw_5nrcfKUQ';

// Route Supabase traffic through a same-origin proxy so the app works in
// environments that restrict cross-domain requests (e.g. WeChat browser).
// Both Vite dev-server and app.py forward /supabase-api/* to Supabase cloud.
const SUPABASE_URL =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.host}/supabase-api`
    : SUPABASE_REMOTE_URL;

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
