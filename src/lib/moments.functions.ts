import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type MomentRow = {
  id: string;
  name: string;
  time_filter: string | null;
  company_filter: string | null;
  mood_filter: string | null;
  type_filter: string | null;
  attention_filter: string | null;
  novelty_filter: string | null;
  season_hint: string | null;
  weather_hint: string | null;
  use_location: boolean;
  platforms: string[];
  auto_detected: boolean;
  created_at: string;
};

export const listMoments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("moments")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as MomentRow[];
  });

const saveSchema = z.object({
  name: z.string().min(1).max(80),
  time_filter: z.string().nullable(),
  company_filter: z.string().nullable(),
  mood_filter: z.string().nullable(),
  type_filter: z.string().nullable(),
  attention_filter: z.string().nullable().optional().default(null),
  novelty_filter: z.string().nullable().optional().default(null),
  season_hint: z.string().nullable().optional().default(null),
  weather_hint: z.string().nullable().optional().default(null),
  use_location: z.boolean().optional().default(false),
  platforms: z.array(z.string().min(1).max(40)).max(10),
  auto_detected: z.boolean().default(false),
});

export const saveMoment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => saveSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("moments")
      .insert({ ...data, user_id: context.userId })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as MomentRow;
  });

export const deleteMoment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("moments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------- Profile (default platforms + perfil de gusto) ---------- */

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("default_platforms, age_bracket, seed_loved")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      default_platforms: (data?.default_platforms ?? []) as string[],
      age_bracket: (data?.age_bracket ?? null) as string | null,
      seed_loved: (data?.seed_loved ?? []) as string[],
    };
  });

export const setDefaultPlatforms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ platforms: z.array(z.string().min(1).max(40)).max(10) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .upsert({ id: context.userId, default_platforms: data.platforms });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Migra el "seed" del invitado (edad + títulos amados declarados en el onboarding)
 * a la cuenta recién creada. Solo escribe campos que estén vacíos en el perfil:
 * nunca pisa datos ya guardados por el usuario.
 */
const migrateSeedSchema = z.object({
  ageBracket: z.enum(["18-29", "30-45", "46+"]).nullable().optional(),
  lovedTitles: z.array(z.string().min(1).max(200)).max(8).optional().default([]),
});

export const migrateGuestSeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => migrateSeedSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: current } = await context.supabase
      .from("profiles")
      .select("age_bracket, seed_loved")
      .eq("id", context.userId)
      .maybeSingle();

    const patch: { id: string; age_bracket?: string | null; seed_loved?: string[] } = {
      id: context.userId,
    };
    if (!current?.age_bracket && data.ageBracket) {
      patch.age_bracket = data.ageBracket;
    }
    const existingLoved = (current?.seed_loved ?? []) as string[];
    if (existingLoved.length === 0 && data.lovedTitles && data.lovedTitles.length > 0) {
      patch.seed_loved = data.lovedTitles;
    }

    if (!patch.age_bracket && !patch.seed_loved) {
      return { migrated: false };
    }

    const { error } = await context.supabase.from("profiles").upsert(patch);
    if (error) throw new Error(error.message);
    return { migrated: true };
  });

/* ---------- Pattern detection ---------- */

export const detectPattern = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: history } = await context.supabase
      .from("search_history")
      .select("time_filter,company_filter,mood_filter,type_filter,platforms")
      .gte("created_at", since)
      .limit(200);

    if (!history || history.length < 3) return { suggestion: null };

    const counts = new Map<string, { count: number; row: any }>();
    for (const row of history) {
      const key = JSON.stringify([
        row.time_filter,
        row.company_filter,
        row.mood_filter,
        row.type_filter,
        [...(row.platforms ?? [])].sort(),
      ]);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { count: 1, row });
    }

    let top: { count: number; row: any } | null = null;
    for (const entry of counts.values()) {
      if (entry.count >= 3 && (!top || entry.count > top.count)) top = entry;
    }
    if (!top) return { suggestion: null };

    // ¿Ya existe como Momento?
    const { data: existing } = await context.supabase
      .from("moments")
      .select("id,time_filter,company_filter,mood_filter,type_filter,platforms");
    const matches = (existing ?? []).some(
      (m: any) =>
        m.time_filter === top!.row.time_filter &&
        m.company_filter === top!.row.company_filter &&
        m.mood_filter === top!.row.mood_filter &&
        m.type_filter === top!.row.type_filter &&
        JSON.stringify([...(m.platforms ?? [])].sort()) ===
          JSON.stringify([...(top!.row.platforms ?? [])].sort()),
    );
    if (matches) return { suggestion: null };

    return {
      suggestion: {
        time_filter: top.row.time_filter,
        company_filter: top.row.company_filter,
        mood_filter: top.row.mood_filter,
        type_filter: top.row.type_filter,
        platforms: top.row.platforms ?? [],
        count: top.count,
      },
    };
  });
