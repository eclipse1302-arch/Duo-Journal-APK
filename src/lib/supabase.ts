import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://nxjhygndibrmapwofvcs.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_75cj42cz40b7Qgox5_XwAw_5nrcfKUQ';

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
