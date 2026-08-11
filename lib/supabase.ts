import { createClient } from "@supabase/supabase-js";

const configuredSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!configuredSupabaseUrl || !supabasePublishableKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );
}

// Vercel must receive the project base URL. Supabase's dashboard also shows
// endpoint URLs ending in /rest/v1 or /auth/v1; accepting those here prevents
// the auth client from producing an invalid doubled request path.
const supabaseUrl = configuredSupabaseUrl
  .trim()
  .replace(/\/(?:rest|auth|storage|realtime)\/v1\/?$/i, "")
  .replace(/\/+$/, "");

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL must be the Supabase project URL");
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
