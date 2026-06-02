// Optional auth helper: returns { userId, supabase } if a valid bearer is present, otherwise null.
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export async function getOptionalUser(): Promise<
  | { userId: string; supabase: ReturnType<typeof createClient<Database>> }
  | null
> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null;

  const request = getRequest();
  const authHeader = request?.headers?.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length);
  if (!token) return null;

  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims?.sub) return null;
    return { userId: data.claims.sub, supabase };
  } catch {
    return null;
  }
}

export async function requireAuth(): Promise<
  { userId: string; supabase: ReturnType<typeof createClient<Database>> }
> {
  const user = await getOptionalUser();
  if (!user) throw new Error("Se requiere autenticación.");
  return user;
}
