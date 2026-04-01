import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

export const client = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);
