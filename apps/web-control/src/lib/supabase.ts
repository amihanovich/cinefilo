// Cliente Supabase para la web-control — usado SOLO para el canal Realtime del
// pairing con la TV. Debe apuntar al MISMO proyecto/clave que usan la app de TV
// y el /control original, sino el QR conecta a otro proyecto y el emparejamiento
// falla en silencio.
//
// Defaults = la publishable key (pública por diseño), la misma que ya está
// commiteada en apps/tv y en public/tv-lite.html. Como fallback garantiza que el
// pairing funcione aunque falte el .env.

import { createClient } from "@supabase/supabase-js";

const DEFAULT_URL = "https://gyxooovdwputhznnlqhi.supabase.co";
const DEFAULT_KEY = "sb_publishable_Rr1Xw4no3qdm2uFSI1kVYg_4asF5n6o";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || DEFAULT_URL;
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || DEFAULT_KEY;

export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { params: { eventsPerSecond: 10 } },
});
