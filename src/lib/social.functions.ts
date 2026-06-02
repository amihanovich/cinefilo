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
  // joined from user_presence of the other person
  other_display_name: string;
  other_avatar_color: string;
};

/* ── upsertPresence ─────────────────────────────────────────────────────── */

export const upsertPresence = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({
      lat: z.number(),
      lng: z.number(),
      displayName: z.string().min(1).max(40),
      avatarColor: z.string().min(4).max(20),
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

export const findNearbyMatch = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({
      title: z.string().min(1).max(300),
      platform: z.string().min(1).max(60),
      lat: z.number(),
      lng: z.number(),
    }).parse(data),
  )
  .handler(async ({ data }): Promise<SocialMatchRow | null> => {
    const { supabase, userId } = await requireAuth();

    // Find a nearby user who also liked this title
    const { data: rows } = await supabase
      .from("user_presence")
      .select("user_id, display_name, avatar_color, lat, lng")
      .neq("user_id", userId)
      .eq("is_visible", true);

    if (!rows || rows.length === 0) return null;

    // Filter bounding box in JS (no PostGIS available)
    const nearby = rows.filter(
      (r) => Math.abs(r.lat - data.lat) < 0.09 && Math.abs(r.lng - data.lng) < 0.09,
    );
    if (nearby.length === 0) return null;

    // Check which of those nearby users liked this title
    const nearbyIds = nearby.map((r) => r.user_id);
    const { data: feedback } = await supabase
      .from("title_feedback")
      .select("user_id")
      .in("user_id", nearbyIds)
      .eq("title", data.title)
      .in("sentiment", ["like", "love"])
      .limit(1);

    if (!feedback || feedback.length === 0) return null;

    const matchedUserId = feedback[0].user_id;
    const matchedPresence = nearby.find((r) => r.user_id === matchedUserId)!;

    // Insert social_match (UPSERT to avoid duplicates — unique on user_a, user_b, title)
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
