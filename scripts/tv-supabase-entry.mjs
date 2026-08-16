import { createClient } from "@supabase/supabase-js";
// Rebranding Miru: se exponen AMBOS globals porque public/tv-supabase.js puede
// quedar cacheado en la WebView de TVs viejas — tv-lite.html lee
// `window.MiruSB || window.CinefiloSB`, así que HTML nuevo + bundle viejo (y al
// revés) siguen funcionando. Rebuild manual:
//   npx esbuild scripts/tv-supabase-entry.mjs --bundle --minify --outfile=public/tv-supabase.js
window.MiruSB = window.CinefiloSB = { createClient: createClient };
