// Keep-alive de Supabase: el plan free pausa los proyectos tras ~1 semana sin
// actividad de base de datos, y Cinéfilo usa Supabase SOLO para el canal
// Realtime del pairing (nunca toca la DB) — así que para Supabase el proyecto
// parece muerto aunque se use todos los días (2026-08: se pausó y el pairing
// quedó caído). Una query mínima diaria alcanza para que cuente como activo.
//
// La publishable key es pública por diseño (es la misma commiteada en los
// clientes); RLS puede devolver 0 filas o un error de permisos y no importa:
// la query igual llega a Postgres, que es lo único que cuenta como actividad.

const SUPABASE_URL = process.env.SUPABASE_URL || "https://gyxooovdwputhznnlqhi.supabase.co";
const SUPABASE_KEY =
  process.env.SUPABASE_ANON_KEY || "sb_publishable_Rr1Xw4no3qdm2uFSI1kVYg_4asF5n6o";
const PING_EVERY_MS = 24 * 60 * 60 * 1000;

async function ping() {
  try {
    // user_presence: tabla huérfana del Modo Social descartado — quedó en el
    // proyecto y sirve justo para esto. select=*&limit=1 funciona sea cual sea
    // su esquema.
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/user_presence?select=*&limit=1`,
      {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        signal: AbortSignal.timeout(10000),
      },
    );
    console.log(`[keepalive] ping a Supabase → HTTP ${res.status}`);
  } catch (e) {
    console.warn(`[keepalive] ping a Supabase falló: ${e.message}`);
  }
}

export function startSupabaseKeepAlive() {
  void ping(); // al boot: los deploys de Railway ya cuentan como actividad
  const timer = setInterval(ping, PING_EVERY_MS);
  if (typeof timer.unref === "function") timer.unref();
}
