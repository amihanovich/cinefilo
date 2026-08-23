-- Bucket público para los binarios (APK) de las apps de Cinéfilo.
-- Lo lee la landing (apps/landing) vía manifest.json; lo escribe el script
-- scripts/publish-build.mjs con el service role key (bypassa RLS).
insert into storage.buckets (id, name, public)
values ('app-builds', 'app-builds', true)
on conflict (id) do update set public = true;
