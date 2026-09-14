import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getOptionalUser } from "@/lib/auth-optional";

const feedbackSchema = z.object({
  title: z.string().min(1).max(200),
  platform: z.string().min(1).max(80).nullable().optional(),
  sentiment: z.enum(["seen", "like", "love", "dislike"]),
});

export const recordTitleFeedback = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => feedbackSchema.parse(d))
  .handler(async ({ data }) => {
    const user = await getOptionalUser();
    if (!user) return { ok: false as const, reason: "guest" };

    // upsert por (user, lower(title), sentiment) — idempotente
    const { error } = await user.supabase.from("title_feedback").insert({
      user_id: user.userId,
      title: data.title,
      platform: data.platform ?? null,
      sentiment: data.sentiment,
    });
    // 23505 = unique_violation → ya existía, lo ignoramos
    if (error && error.code !== "23505") {
      console.error("[feedback] insert error:", error);
      return { ok: false as const, reason: "error" };
    }
    return { ok: true as const };
  });

const getTitlesBySentimentSchema = z.object({
  sentiment: z.enum(["love", "like", "dislike", "seen"]),
});

export const getTitlesBySentiment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => getTitlesBySentimentSchema.parse(d))
  .handler(async ({ data }) => {
    const user = await getOptionalUser();
    if (!user) return [] as { title: string; platform: string | null }[];
    const { data: rows, error } = await user.supabase
      .from("title_feedback")
      .select("title, platform")
      .eq("user_id", user.userId)
      .eq("sentiment", data.sentiment)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error || !rows) return [] as { title: string; platform: string | null }[];
    return rows as { title: string; platform: string | null }[];
  });


const resetSchema = z.object({
  scope: z.enum(["all", "preferences", "seen"]).default("all"),
});

/** Borra el historial de feedback del usuario (para resetear el perfil de gusto). */
export const resetTitleFeedback = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => resetSchema.parse(d ?? {}))
  .handler(async ({ data }) => {
    const user = await getOptionalUser();
    if (!user) return { ok: false as const, reason: "guest", deleted: 0 };

    let query = user.supabase.from("title_feedback").delete().eq("user_id", user.userId);
    if (data.scope === "preferences") {
      query = query.in("sentiment", ["like", "love"]);
    } else if (data.scope === "seen") {
      query = query.eq("sentiment", "seen");
    }
    const { data: deleted, error } = await query.select("id");
    if (error) {
      console.error("[feedback] reset error:", error);
      return { ok: false as const, reason: "error", deleted: 0 };
    }
    return { ok: true as const, deleted: deleted?.length ?? 0 };
  });

export type TasteSnapshot = {
  loved: string[];
  liked: string[];
  disliked: string[];
  seen: string[];
};

/** Resumen del gusto del usuario para inyectar en el prompt de recomendaciones. */
export async function getTasteSnapshot(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  opts: { loveLimit?: number; likeLimit?: number; dislikeLimit?: number; seenLimit?: number } = {},
): Promise<TasteSnapshot> {
  const loveLimit = opts.loveLimit ?? 12;
  const likeLimit = opts.likeLimit ?? 12;
  const dislikeLimit = opts.dislikeLimit ?? 20;
  const seenLimit = opts.seenLimit ?? 40;

  const { data, error } = await supabase
    .from("title_feedback")
    .select("title,sentiment")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(loveLimit + likeLimit + dislikeLimit + seenLimit);
  if (error || !data) return { loved: [], liked: [], disliked: [], seen: [] };

  const loved: string[] = [];
  const liked: string[] = [];
  const disliked: string[] = [];
  const seen: string[] = [];
  for (const row of data as { title: string; sentiment: "seen" | "like" | "love" | "dislike" }[]) {
    if (row.sentiment === "love" && loved.length < loveLimit) loved.push(row.title);
    else if (row.sentiment === "like" && liked.length < likeLimit) liked.push(row.title);
    else if (row.sentiment === "dislike" && disliked.length < dislikeLimit) disliked.push(row.title);
    else if (row.sentiment === "seen" && seen.length < seenLimit) seen.push(row.title);
  }
  return { loved, liked, disliked, seen };
}
