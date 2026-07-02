// Cliente Supabase para la app de TV — usado SOLO para el canal Realtime del
// pairing con el teléfono. Debe apuntar al MISMO proyecto/clave que usan
// public/tv-lite.html y src/routes/control.tsx (el /control desplegado), sino
// el QR conecta a otro proyecto y el emparejamiento falla en silencio.

import { createClient } from "@supabase/supabase-js";

// Defaults = las mismas credenciales que ya están hardcodeadas (y commiteadas)
// en public/tv-lite.html. Son la publishable key (pública por diseño). Tenerlas
// como fallback garantiza que el pairing funcione aunque falte el .env, y evita
// que un build sin variables crashee la app entera al arrancar.
const DEFAULT_URL = "https://gyxooovdwputhznnlqhi.supabase.co";
const DEFAULT_KEY = "sb_publishable_Rr1Xw4no3qdm2uFSI1kVYg_4asF5n6o";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || DEFAULT_URL;
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || DEFAULT_KEY;

export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { params: { eventsPerSecond: 10 } },
});
