import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-optional";

export type SocialMatchRow = {
  id: string;
  user_a: string;
  user_b: string;
  title: string;
  platform: string;
  matched_at: string;
  other_display_name: string;
  other_avatar_color: string;
};

export type MoodFilters = {
  mood: string | null;
  company: string | null;
  attention: string | null;
  type: string | null;
};

/* ── upsertPresence ─────────────────────────────────────────────────────── */

export const upsertPresence = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({
      lat: z.number(),
      lng: z.number(),
      displayName: z.string().min(1).max(40),
      avatarColor: z.string().min(4).max(20),
      moodFilter: z.string().nullable().optional(),
      companyFilter: z.string().nullable().optional(),
      attentionFilter: z.string().nullable().optional(),
      typeFilter: z.string().nullable().optional(),
    }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabase, userId } = await requireAuth();
    await supabase.from("user_presence").upsert(
      {
        user_id: userId,
        lat: data.lat,
        lng: data.lng,
        display_name: data.displayName,
        avatar_color: data.avatarColor,
        is_visible: true,
        last_seen: new Date().toISOString(),
        mood_filter: data.moodFilter ?? null,
        company_filter: data.companyFilter ?? null,
        attention_filter: data.attentionFilter ?? null,
        type_filter: data.typeFilter ?? null,
      },
      { onConflict: "user_id" },
    );
  });

/* ── removePresence ─────────────────────────────────────────────────────── */

export const removePresence = createServerFn({ method: "POST" })
  .handler(async () => {
    const { supabase, userId } = await requireAuth();
    await supabase.from("user_presence").delete().eq("user_id", userId);
  });

/* ── findNearbyMatch ────────────────────────────────────────────────────── */
// Bounding-box ~10km: ABS(lat diff) < 0.09 && ABS(lng diff) < 0.09
// Scores mood overlap to prefer users sharing the same context.

function moodOverlapScore(
  a: { mood_filter: string | null; company_filter: string | null; attention_filter: string | null },
  moodFilters: MoodFilters,
): number {
  let score = 0;
  if (moodFilters.mood && a.mood_filter === moodFilters.mood) score += 2;
  if (moodFilters.company && a.company_filter === moodFilters.company) score += 3;
  if (moodFilters.attention && a.attention_filter === moodFilters.attention) score += 1;
  return score;
}

export const findNearbyMatch = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({
      title: z.string().min(1).max(300),
      platform: z.string().min(1).max(60),
      lat: z.number(),
      lng: z.number(),
      moodFilters: z.object({
        mood: z.string().nullable(),
        company: z.string().nullable(),
        attention: z.string().nullable(),
        type: z.string().nullable(),
      }).optional(),
    }).parse(data),
  )
  .handler(async ({ data }): Promise<SocialMatchRow | null> => {
    const { supabase, userId } = await requireAuth();

    const { data: rows } = await supabase
      .from("user_presence")
      .select("user_id, display_name, avatar_color, lat, lng, mood_filter, company_filter, attention_filter")
      .neq("user_id", userId)
      .eq("is_visible", true);

    if (!rows || rows.length === 0) return null;

    const nearby = rows.filter(
      (r) => Math.abs(r.lat - data.lat) < 0.09 && Math.abs(r.lng - data.lng) < 0.09,
    );
    if (nearby.length === 0) return null;

    // Sort nearby by mood overlap (highest first) so we prefer contextual matches
    const sorted = data.moodFilters
      ? [...nearby].sort((a, b) => moodOverlapScore(b, data.moodFilters!) - moodOverlapScore(a, data.moodFilters!))
      : nearby;

    const nearbyIds = sorted.map((r) => r.user_id);
    const { data: feedback } = await supabase
      .from("title_feedback")
      .select("user_id")
      .in("user_id", nearbyIds)
      .eq("title", data.title)
      .in("sentiment", ["like", "love"])
      .limit(1);

    if (!feedback || feedback.length === 0) return null;

    const matchedUserId = feedback[0].user_id;
    const matchedPresence = sorted.find((r) => r.user_id === matchedUserId)!;

    const { data: inserted, error } = await supabase
      .from("social_matches")
      .upsert(
        {
          user_a: userId,
          user_b: matchedUserId,
          title: data.title,
          platform: data.platform,
        },
        { onConflict: "user_a,user_b,title", ignoreDuplicates: false },
      )
      .select()
      .single();

    if (error || !inserted) return null;

    return {
      ...inserted,
      other_display_name: matchedPresence.display_name,
      other_avatar_color: matchedPresence.avatar_color,
    };
  });

/* ── findNearbyMoodCount ────────────────────────────────────────────────── */
// Returns how many visible nearby users share at least one mood dimension.
// Used to power the "X personas cerca en el mismo mood" banner.

export const findNearbyMoodCount = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({
      lat: z.number(),
      lng: z.number(),
      moodFilters: z.object({
        mood: z.string().nullable(),
        company: z.string().nullable(),
        attention: z.string().nullable(),
        type: z.string().nullable(),
      }),
    }).parse(data),
  )
  .handler(async ({ data }): Promise<number> => {
    const { supabase, userId } = await requireAuth();

    const { data: rows } = await supabase
      .from("user_presence")
      .select("user_id, lat, lng, mood_filter, company_filter, attention_filter")
      .neq("user_id", userId)
      .eq("is_visible", true);

    if (!rows) return 0;

    return rows.filter(
      (r) =>
        Math.abs(r.lat - data.lat) < 0.09 &&
        Math.abs(r.lng - data.lng) < 0.09 &&
        moodOverlapScore(r, data.moodFilters) > 0,
    ).length;
  });

/* ── updatePresenceMood ─────────────────────────────────────────────────── */
// Updates only the mood columns of an existing presence row (keeps display_name intact).

export const updatePresenceMood = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({
      moodFilter: z.string().nullable(),
      companyFilter: z.string().nullable(),
      attentionFilter: z.string().nullable(),
      typeFilter: z.string().nullable(),
    }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabase, userId } = await requireAuth();
    await supabase
      .from("user_presence")
      .update({
        mood_filter: data.moodFilter,
        company_filter: data.companyFilter,
        attention_filter: data.attentionFilter,
        type_filter: data.typeFilter,
        last_seen: new Date().toISOString(),
      })
      .eq("user_id", userId);
  });

/* ── saveDisplayName ────────────────────────────────────────────────────── */

export const saveDisplayName = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({
      displayName: z.string().min(1).max(40),
      avatarColor: z.string().min(4).max(20),
    }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabase, userId } = await requireAuth();
    await supabase
      .from("profiles")
      .update({ display_name: data.displayName, avatar_color: data.avatarColor })
      .eq("id", userId);
  });
