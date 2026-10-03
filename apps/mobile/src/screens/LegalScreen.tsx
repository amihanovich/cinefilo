// Política de privacidad y términos de uso (/privacidad y /terminos). Las pide
// Google para publicar el login, y la ley argentina de datos personales. Dicen
// lo que Miru REALMENTE hace con los datos: si cambia lo que se guarda o con
// quién se comparte, hay que actualizar esto en el mismo cambio.

import { MiruMark } from "../components/MiruMark";

// Mail de contacto para pedidos de privacidad. ⚠️ Tiene que existir y llegarle
// a alguien (p. ej. un reenvío desde el dominio).
export const CONTACT_EMAIL = "hola@mirumovies.com";
const UPDATED = "3 de octubre de 2026";

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-5 pb-16 pt-8 safe-top">
        <a href="/" className="flex items-center gap-2 text-foreground no-underline">
          <MiruMark size={20} />
          <span className="font-serif text-[18px] font-bold">Miru</span>
        </a>
        <h1 className="mt-8 font-serif text-[32px] font-bold leading-tight">{title}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Última actualización: {UPDATED}</p>
        <div className="legal mt-6 space-y-4 text-[15px] leading-relaxed text-foreground/90">{children}</div>
        <p className="mt-10 text-[13px] text-muted-foreground">
          <a href="/privacidad" className="underline">Privacidad</a> · <a href="/terminos" className="underline">Términos</a> · <a href="/" className="underline">Volver a Miru</a>
        </p>
      </div>
    </div>
  );
}

const H = ({ children }: { children: React.ReactNode }) => <h2 className="pt-4 font-serif text-[21px] font-bold text-foreground">{children}</h2>;
const Ul = ({ children }: { children: React.ReactNode }) => <ul className="list-disc space-y-1.5 pl-5">{children}</ul>;

export function PrivacyPage() {
  return (
    <Shell title="Política de privacidad">
      <p>
        Miru (<strong>mirumovies.com</strong>) es un recomendador de películas y series: le pedís algo y te propone qué ver
        en las plataformas que ya tenés. Esta política explica qué datos usamos, para qué y qué podés hacer con ellos.
      </p>

      <H>Qué datos guardamos</H>
      <Ul>
        <li><strong>Tu cuenta</strong>: nombre, mail y foto de perfil, si entrás con Google; o nombre, mail y contraseña (guardada cifrada), si entrás con mail.</li>
        <li><strong>Tus gustos</strong>: lo que le pediste a Miru, lo que fuiste a ver desde Miru, lo que descartaste y por qué, tus reacciones (👍/👎) y tus respuestas a "¿qué tal estuvo?", tus plataformas elegidas, y un perfil de gusto que Miru arma con eso.</li>
        <li><strong>Uso sin cuenta</strong>: si usás Miru sin cuenta, esa información queda solo en tu dispositivo. Si después creás una cuenta, se suma a ella.</li>
      </Ul>

      <H>Para qué los usamos</H>
      <p>
        Solo para recomendarte mejor: para saludarte por tu nombre, no repetirte lo que ya viste y elegir según lo que te
        gusta. <strong>No vendemos tus datos ni los usamos para publicidad.</strong>
      </p>

      <H>Con quién se comparten</H>
      <p>Para funcionar, Miru usa estos servicios, que procesan la información solo para prestarnos su servicio:</p>
      <Ul>
        <li><strong>Supabase</strong>: aloja tu cuenta y tus gustos.</li>
        <li><strong>Google</strong>: si elegís entrar con Google.</li>
        <li><strong>Anthropic (Claude)</strong>: procesa tus pedidos y tu perfil de gusto para elegir y escribir la recomendación.</li>
        <li><strong>Groq</strong>: pasa a texto lo que decís por voz. El audio no se guarda.</li>
        <li><strong>ElevenLabs</strong>: genera la voz de Miru a partir del texto de la respuesta.</li>
        <li><strong>TMDB y JustWatch</strong>: para saber en qué plataforma está cada título. Solo reciben el nombre del título y tu país.</li>
        <li><strong>PostHog</strong>: métricas de uso (por ejemplo, qué botones se tocan), para mejorar la app.</li>
        <li><strong>ipapi</strong>: para detectar tu país una vez (y así mostrarte lo que hay disponible donde estás).</li>
        <li><strong>Railway</strong>: aloja la app y su servidor.</li>
      </Ul>

      <H>Cuánto tiempo los guardamos</H>
      <p>Mientras tengas tu cuenta. Si la borrás, se borran tu cuenta y tus gustos.</p>

      <H>Tus derechos</H>
      <p>
        Podés ver, corregir o borrar tus datos. Para <strong>borrar tu cuenta y todos tus datos</strong>, entrá a Miru →
        Mi cuenta → <strong>Borrar mi cuenta</strong>. Para cualquier otro pedido, escribinos a{" "}
        <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
      <p className="text-[13px] text-muted-foreground">
        Ley 25.326 de Protección de Datos Personales (Argentina): el titular de los datos tiene la facultad de ejercer el
        derecho de acceso a los mismos en forma gratuita a intervalos no inferiores a seis meses, salvo que se acredite un
        interés legítimo al efecto (art. 14, inc. 3). La Agencia de Acceso a la Información Pública, órgano de control de la
        Ley 25.326, tiene la atribución de atender las denuncias y reclamos que se interpongan con relación al
        incumplimiento de las normas sobre protección de datos personales.
      </p>

      <H>Menores</H>
      <p>Miru no está pensada para menores de 13 años.</p>

      <H>Cambios</H>
      <p>Si cambia algo importante de esta política, lo vas a ver acá con la fecha actualizada.</p>
    </Shell>
  );
}

export function TermsPage() {
  return (
    <Shell title="Términos de uso">
      <p>
        Al usar Miru (<strong>mirumovies.com</strong>) aceptás estos términos. Son cortos y en castellano llano.
      </p>

      <H>Qué es Miru</H>
      <p>
        Un recomendador de películas y series con inteligencia artificial. Te sugiere qué ver y te lleva a la plataforma
        donde está. <strong>Miru no es una plataforma de streaming</strong>: para ver el contenido necesitás tu propia
        suscripción a esa plataforma.
      </p>

      <H>Las recomendaciones</H>
      <p>
        Las recomendaciones las genera una inteligencia artificial y son una sugerencia, no una garantía. La
        disponibilidad de cada título la verificamos con fuentes externas, pero puede cambiar o tener errores. Las
        clasificaciones por edad son orientativas.
      </p>

      <H>Tu cuenta</H>
      <Ul>
        <li>Podés probar Miru sin cuenta un número limitado de veces; después hace falta crear una.</li>
        <li>Sos responsable de lo que hagas con tu cuenta. Podés borrarla cuando quieras desde Mi cuenta.</li>
        <li>No uses Miru para nada ilegal, ni intentes abusar del servicio (por ejemplo, automatizar pedidos masivos).</li>
      </Ul>

      <H>Marcas</H>
      <p>
        Los nombres, logos y pósters de plataformas, películas y series pertenecen a sus dueños y se muestran solo para
        identificar el contenido. Datos de disponibilidad: JustWatch y TMDB.
      </p>

      <H>El servicio</H>
      <p>
        Miru se ofrece "tal cual". Podemos cambiarlo, mejorarlo o discontinuar partes. Hacemos lo posible para que
        funcione bien, pero no podemos garantizar que esté siempre disponible ni libre de errores.
      </p>

      <H>Contacto</H>
      <p>
        Escribinos a <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Estos términos se rigen
        por las leyes de la República Argentina.
      </p>
    </Shell>
  );
}
