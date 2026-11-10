// Browser client for Moonveil Club.
// supabase-js is loaded from a CDN in the page. Node (the test script) uses the
// npm package so the same modules can be exercised without a browser.

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config.js';

const SUPABASE_JS_URL = 'https://esm.sh/@supabase/supabase-js@2.119.0';

function memoryStorage() {
  const memory = new Map();
  return {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => {
      memory.set(key, String(value));
    },
    removeItem: (key) => {
      memory.delete(key);
    },
  };
}

async function loadCreateClient() {
  if (typeof window === 'undefined') {
    const mod = await import('@supabase/supabase-js');
    return mod.createClient;
  }
  const mod = await import(SUPABASE_JS_URL);
  return mod.createClient;
}

export async function createMoonveilClient(url = SUPABASE_URL, anonKey = SUPABASE_ANON_KEY, options = {}) {
  if (!url || !anonKey) {
    throw new Error('js/net/config.js is missing the public Supabase URL or anon key.');
  }
  const createClient = await loadCreateClient();
  const browser = typeof window !== 'undefined';
  const { auth: authOptions = {}, ...rest } = options;
  return createClient(url, anonKey, {
    ...rest,
    auth: {
      persistSession: browser,
      autoRefreshToken: true,
      detectSessionInUrl: browser,
      storage: browser ? window.localStorage : memoryStorage(),
      ...authOptions,
    },
  });
}

export const supabase = await createMoonveilClient();
