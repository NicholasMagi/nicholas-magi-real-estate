import { createClient } from "@supabase/supabase-js";
import { secureStoreAdapter } from "@/shared/supabase/secureStoreAdapter";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "";
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
const validHttpsUrl = /^https:\/\/[^\s/]+(?::\d+)?(?:\/.*)?$/i.test(supabaseUrl);
const validPublicKey =
  supabasePublishableKey.startsWith("sb_publishable_") ||
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(supabasePublishableKey);
const forbiddenSecretKey = supabasePublishableKey.startsWith("sb_secret_");

export const supabase =
  validHttpsUrl && validPublicKey && !forbiddenSecretKey
    ? createClient(supabaseUrl, supabasePublishableKey, {
        auth: {
          storage: secureStoreAdapter,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false
        }
      })
    : null;

export const isSupabaseConfigured = supabase !== null;
