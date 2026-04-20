const { createClient } = require('@supabase/supabase-js');

let supabaseClient;
const SCHEMA_ERROR_PATTERNS = [
  'could not find',
  'column',
  'schema cache',
  'does not exist',
  'unknown field',
];

function hasSupabaseConfig() {
  return Boolean(
    process.env.SUPABASE_URL &&
      (process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY),
  );
}

function getSupabaseConfig() {
  return {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey:
      process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,
  };
}

function getSupabaseClient() {
  const { supabaseUrl, supabaseKey } = getSupabaseConfig();

  if (!supabaseUrl || !supabaseKey) {
    const error = new Error(
      'Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_KEY, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_ANON_KEY.',
    );
    error.statusCode = 503;
    throw error;
  }

  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return supabaseClient;
}

function isSchemaError(error) {
  const message = String(error?.message || '').toLowerCase();
  return SCHEMA_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

function isMissingRelationError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('relation') && message.includes('does not exist');
}

module.exports = {
  getSupabaseClient,
  hasSupabaseConfig,
  isMissingRelationError,
  isSchemaError,
};
