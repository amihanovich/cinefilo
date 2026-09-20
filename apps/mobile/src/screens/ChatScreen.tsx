// Miru conversacional: la app ES la charla. Le pedís algo (voz o texto) y te
// devuelve UNA película, bien justificada — como el experto del videoclub.
// Todo lo demás (grilla, tops, Mi lista, control de TV) queda como capa
// guardada en el repo; acá solo entra lo que sirve a la conversación.
//
// Regla de voz: "habla si le hablaste". Si el pedido entró por voz, Miru
// contesta hablado; si lo escribiste, contesta escrito.

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Send, User, Volume2, VolumeX, RefreshCw, Loader2 } from "lucide-react";
import { Orb } from "../components/Orb";
import { VoicePill, type VoicePillState } from "../components/VoicePill";
import { BrandSplash } from "../components/BrandSplash";
import { AccountSheet } from "../components/AccountSheet";
import { ControlScreen } from "./ControlScreen";
import { fetchRecommendation, fetchPosters, warmupBackend, type Message, type Recommendation } from "../lib/api";
import { inferContext, contextToPromptHint, seasonHintShort } from "../lib/context";
import { colorForPlatform, platformLabel, textOnPlatform } from "../lib/deeplink";
import { jwSearch, type JwResult } from "../lib/justwatch";
import { openStreaming } from "../lib/watch";
import { VoiceRecorder, transcribe } from "../lib/stt";
import { speak, stopSpeaking, isMuted, setMuted } from "../lib/tts";
import { PLATFORMS, loadPlatforms, seedPlatforms, detectCountry, getCountry } from "../lib/prefs";
import { pickTvSession } from "../lib/tv-remote";
import { track } from "../lib/analytics";
import { useBackLayer } from "../lib/back";

const GREETING = "Hola, soy Miru. Decime qué tenés ganas de ver y te elijo una.";
const SPLASH_MSG = "Rastrillando las plataformas para encontrar lo tuyo…";
// Ejemplos tocables (anti-parálisis): muestran QUÉ se le puede pedir.
const EXAMPLES = ["Algo de terror liviano", "Una comedia para reír", "Algo corto y bueno"];

type Turn =
  | { kind: "miru"; id: string; text: string; tone?: "question" | "error" }
  | { kind: "user"; id: string; text: string }
  | { kind: "reco"; id: string; item: Recommendation }
  | { kind: "thinking"; id: string };

let seq = 0;
const uid = () => `t${++seq}`;

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function ChatScreen() {
  const [phase, setPhase] = useState<"splash" | "chat">("splash");
  const [turns, setTurns] = useState<Turn[]>([{ kind: "miru", id: uid(), text: GREETING }]);
  const [platforms, setPlatforms] = useState<string[]>(loadPlatforms);
  const [posters, setPosters] = useState<Record<string, string | null>>({});
  const [availability, setAvailability] = useState<Record<string, JwResult>>({});
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [micState, setMicState] = useState<"idle" | "requesting" | "rec" | "processing">("idle");
  const [volume, setVolume] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [ttsMuted, setTtsMuted] = useState(() => { try { return isMuted(); } catch { return false; } });
  const [accountOpen, setAccountOpen] = useState(false);
  const [controlSession, setControlSession] = useState<string | null>(null);

  // El historial de la conversación viaja al backend en cada turno (los
  // refinamientos —"más corta", "algo más liviano"— salen gratis de ahí). Va en
  // un ref: no se renderiza, y así ningún callback lo lee desactualizado.
  const historyRef = useRef<Message[]>([]);
  const shownRef = useRef<Set<string>>(new Set()); // títulos ya propuestos → excludeTitles
  const busyRef = useRef(false);
  const micRef = useRef<VoiceRecorder | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  // Turno al que saltar cuando llega la respuesta: con la ficha larga, ir al
  // final del hilo dejaba al usuario mirando el botón en vez del título.
  const anchorRef = useRef<string | null>(null);

  const lastReco = [...turns].reverse().find((t): t is Extract<Turn, { kind: "reco" }> => t.kind === "reco");

  // Splash corto: cubre el cold start de Railway y el saludo queda listo abajo.
  useEffect(() => {
    seedPlatforms();
    void detectCountry();
    warmupBackend();
    const t = setTimeout(() => setPhase("chat"), 1200);
    return () => clearTimeout(t);
  }, []);

  // El hilo siempre muestra lo último (el pedido recién enviado, la respuesta).
  useEffect(() => {
    const anchor = anchorRef.current;
    if (anchor) {
      anchorRef.current = null;
      const el = document.querySelector(`[data-turn="${anchor}"]`);
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    }
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  useEffect(() => () => stopSpeaking(), []);

  const say = (text: string, tone?: "question" | "error") =>
    setTurns((prev) => [...prev, { kind: "miru", id: uid(), text, tone }]);

  // ── Un turno de conversación ───────────────────────────────────────────────
  const askMiru = useCallback(async (raw: string, source: "text" | "voice") => {
    const q = raw.trim();
    if (!q || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    stopSpeaking();
    setSpeaking(false);

    const turnNumber = historyRef.current.filter((m) => m.role === "user").length + 1;
    track("chat_turn", { source, turn_number: turnNumber });

    const history: Message[] = [...historyRef.current, { role: "user", content: q }];
    setTurns((prev) => [...prev, { kind: "user", id: uid(), text: q }, { kind: "thinking", id: uid() }]);
    const t0 = performance.now();
    const ctx = inferContext();

    try {
      const data = await fetchRecommendation({
        messages: history,
        platforms: platforms.length > 0 ? platforms : PLATFORMS,
        contextHint: contextToPromptHint(ctx),
        seasonHint: seasonHintShort(ctx),
        weatherHint: null,
        excludeTitles: [...shownRef.current].slice(-40), // cap: no inflar el prompt
        alternativesCount: 0, // modo "una sola": el porqué largo es el producto
        country: getCountry(),
      });
      const main = data?.main;
      if (!main?.title) throw new Error("sin resultado");

      shownRef.current.add(main.title);
      historyRef.current = [
        ...history,
        { role: "assistant", content: `Recomendé: ${main.title} (${main.platform}). ${main.reason}` },
      ];

      const note = (data.cinephile_note ?? "").trim();
      const question = (data.clarification_needed ?? "").trim();
      const noteId = uid();
      const recoId = uid();
      anchorRef.current = note ? noteId : recoId;
      setTurns((prev) => [
        ...prev.filter((t) => t.kind !== "thinking"),
        ...(note ? [{ kind: "miru", id: noteId, text: note } as Turn] : []),
        { kind: "reco", id: recoId, item: main },
        // La repregunta va DESPUÉS de la película: Miru nunca deja al usuario con
        // las manos vacías, solo le ofrece afinar el próximo pedido.
        ...(question ? [{ kind: "miru", id: uid(), text: question, tone: "question" } as Turn] : []),
      ]);

      track("reco_single_received", {
        source,
        ms: Math.round(performance.now() - t0),
        platform: main.platform,
        turn_number: turnNumber,
      });
      if (question) track("clarification_shown");

      // "Habla si le hablaste": la nota se lee siempre, se escucha solo si el
      // pedido entró por voz (y el usuario no silenció a Miru).
      if (source === "voice" && note) {
        void speak(note, () => setSpeaking(true), () => setSpeaking(false));
      }

      void fetchPosters([{ title: main.title, type: main.type, year: main.year }])
        .then((p) => setPosters((prev) => ({ ...prev, ...p })));
      void jwSearch(main.title, main.platform, main.type, getCountry())
        .then((r) => setAvailability((prev) => ({ ...prev, [main.title]: r })))
        .catch(() => { /* sin verificar: el botón cae a buscar en la plataforma */ });
    } catch (e) {
      console.error("[chat]", e);
      setTurns((prev) => [
        ...prev.filter((t) => t.kind !== "thinking"),
        { kind: "miru", id: uid(), text: "Se me cortó la búsqueda. Fijate la conexión y pedímelo de nuevo.", tone: "error" },
      ]);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [platforms]);

  const send = () => {
    const q = text.trim();
    if (!q) return;
    setText("");
    void askMiru(q, "text");
  };

  const another = () => {
    track("another_requested");
    void askMiru("Esa no me convence, dame otra", "text");
  };

  // ── Micrófono: press-to-speak / press-to-stop (la ley de voz de toda la app) ──
  const toggleMic = async () => {
    if (micState === "rec") {
      const rec = micRef.current;
      micRef.current = null;
      setMicState("processing");
      setVolume(0);
      if (!rec) { setMicState("idle"); return; }
      const blob = await rec.stop();
      if (blob.size < 500) { setMicState("idle"); say("No te escuché. Probá de nuevo.", "error"); return; }
      try {
        const heard = (await transcribe(blob)).trim();
        setMicState("idle");
        if (heard) void askMiru(heard, "voice");
        else say("No te escuché. Probá de nuevo.", "error");
      } catch {
        setMicState("idle");
        say("No te escuché. Probá de nuevo.", "error");
      }
      return;
    }
    if (micState !== "idle") return;
    stopSpeaking(); // tocar el orbe mientras Miru habla lo interrumpe
    setSpeaking(false);
    setMicState("requesting"); // getUserMedia queda pendiente con el prompt de permiso
    const rec = new VoiceRecorder();
    micRef.current = rec;
    try {
      await rec.start({ autoStop: false, onVolume: (v) => setVolume(v) });
      setMicState("rec");
    } catch {
      micRef.current = null;
      setMicState("idle");
      say("No pude abrir el micrófono. Habilitá el permiso, o escribime acá abajo.", "error");
    }
  };

  const toggleMute = () => {
    const next = !ttsMuted;
    setTtsMuted(next);
    setMuted(next); // persiste + corta lo que esté sonando
    if (next) setSpeaking(false);
  };

  const openTvRemote = async () => {
    track("tv_remote_open");
    const id = await pickTvSession(() => say("Ese código no me sirve. Mirá el que está debajo del QR.", "error"));
    if (id) setControlSession(id);
  };

  useBackLayer(accountOpen, () => setAccountOpen(false));
  useBackLayer(!!controlSession, () => setControlSession(null));

  if (controlSession) {
    return <ControlScreen session={controlSession} onClose={() => setControlSession(null)} />;
  }
  if (phase === "splash") return <BrandSplash message={SPLASH_MSG} />;

  const orbPhase =
    micState === "rec" ? "listening"
    : micState === "processing" || micState === "requesting" || busy ? "thinking"
    : speaking ? "speaking"
    : "idle";
  const pillState: VoicePillState = micState === "requesting" ? "requesting" : orbPhase;
  const showPill = micState !== "idle" || speaking;

  return (
    <div className="flex h-[100dvh] flex-col bg-background safe-top safe-bottom">
      <AccountSheet
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        onPlatformsChange={setPlatforms}
        onOpenTvRemote={() => void openTvRemote()}
      />

      {/* Header: la marca, el mute de la voz y UNA puerta a los ajustes (que es
          donde vive también "Conectar TV" — la capa de TV no desaparece, deja
          de ocupar la pantalla). */}
      <div className="flex shrink-0 items-center justify-between px-5 pt-5 pb-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-base font-bold text-foreground">Miru</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleMute}
            aria-label={ttsMuted ? "Activar la voz de Miru" : "Silenciar la voz de Miru"}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-full border transition-transform active:scale-90",
              ttsMuted ? "border-border bg-muted text-muted-foreground" : "border-primary/30 bg-primary/5 text-primary",
            )}
          >
            {ttsMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setAccountOpen(true)}
            aria-label="Mi cuenta"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground active:scale-90 transition-transform"
          >
            <User className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* El hilo */}
      <div className={cn(
        "flex-1 min-h-0 overflow-y-auto px-5 pb-4",
        turns.length === 1 && "flex flex-col justify-center",
      )}>
        {turns.map((t) => {
          if (t.kind === "user") {
            return (
              <div key={t.id} className="fade-in mt-4 flex justify-end">
                <p className="max-w-[80%] rounded-3xl rounded-br-lg border border-primary/15 bg-primary/10 px-4 py-2.5 text-[14px] leading-snug text-foreground">
                  {t.text}
                </p>
              </div>
            );
          }
          if (t.kind === "miru") {
            return (
              <div key={t.id} data-turn={t.id} className="fade-in mt-4 flex gap-2.5">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full">
                  <Orb phase="idle" size="mini" sizePx={28} />
                </span>
                <p className={cn(
                  "max-w-[85%] rounded-3xl rounded-bl-lg px-4 py-2.5 text-[14px] leading-relaxed",
                  t.tone === "error" ? "bg-red-500/10 text-red-700"
                  : t.tone === "question" ? "border border-primary/25 bg-primary/5 text-foreground"
                  : "border border-border bg-card text-foreground/90",
                )}>
                  {t.text}
                </p>
              </div>
            );
          }
          if (t.kind === "thinking") {
            return (
              <div key={t.id} className="fade-in mt-4 flex items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full">
                  <Orb phase="thinking" size="mini" sizePx={28} />
                </span>
                <span className="flex items-center gap-2 rounded-3xl rounded-bl-lg border border-border bg-card px-4 py-2.5 text-[13px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando la tuya…
                </span>
              </div>
            );
          }
          return (
            <RecoCard
              key={t.id}
              turnId={t.id}
              item={t.item}
              poster={posters[t.item.title]}
              avail={availability[t.item.title]}
            />
          );
        })}

        {/* El descarte seco, siempre al pie del hilo. Lo demás se habla. */}
        {lastReco && !busy && (
          <div className="mt-3 pl-9">
            <button
              onClick={another}
              className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1.5 text-[12px] font-semibold text-muted-foreground transition-transform active:scale-95"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Dame otra
            </button>
          </div>
        )}

        {/* Ejemplos tocables: solo al arrancar, cuando el hilo es el saludo. */}
        {turns.length === 1 && (
          <div className="mt-5 flex flex-wrap gap-1.5 pl-9">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => void askMiru(ex, "text")}
                className="rounded-full border border-border bg-muted px-3 py-1.5 text-[12px] text-muted-foreground transition-transform active:scale-95"
              >
                {ex}
              </button>
            ))}
          </div>
        )}
        <div ref={endRef} className="h-2" />
      </div>

      {/* Composer: el orbe (hablarle) + escribirle. Las dos puertas, siempre. */}
      <div className="shrink-0 border-t border-border bg-background px-5 pb-3 pt-3">
        {showPill && (
          <div className="mb-2 flex justify-center">
            <VoicePill state={pillState} onClick={() => void toggleMic()} />
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={() => void toggleMic()}
            aria-label={micState === "rec" ? "Frenar" : "Hablarle a Miru"}
            className={cn(
              "relative flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl border transition-all active:scale-95",
              micState === "rec" ? "border-red-400/50 bg-red-500/15" : "border-primary/30 bg-primary/5",
            )}
            style={{ WebkitTapHighlightColor: "transparent" }}
          >
            <Orb phase={orbPhase} size="mini" sizePx={34} volume={volume} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl bg-muted px-3">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              placeholder={micState === "rec" ? "Te escucho…" : busy ? "Buscando…" : "Pedile algo a Miru"}
              disabled={micState === "rec"}
              className="min-h-[52px] min-w-0 flex-1 bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
            />
            <button
              onClick={send}
              disabled={!text.trim() || busy}
              aria-label="Enviar"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-20"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── La película ──────────────────────────────────────────────────────────────
// Una sola, con el porqué entero. El póster acompaña; el texto es el producto.
function RecoCard({
  turnId, item, poster, avail,
}: {
  turnId: string;
  item: Recommendation;
  poster?: string | null;
  avail?: JwResult;
}) {
  const color = colorForPlatform(item.platform);
  const label = platformLabel(item.platform);
  // El celeste de Prime con texto blanco queda ilegible: el color de la tipografía
  // lo decide la luminancia de la marca, no un default.
  const onColor = textOnPlatform(item.platform);
  return (
    <div data-turn={turnId} className="fade-in mt-3 pl-9">
      <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-[0_1px_3px_rgba(41,35,31,0.07)]">
        <div className="flex gap-3 p-3">
          <div className="h-36 w-24 shrink-0 overflow-hidden rounded-xl bg-muted ring-1 ring-border" style={!poster ? { backgroundColor: `${color}20` } : undefined}>
            {poster ? (
              <img src={poster} alt={item.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <span className="text-3xl font-black opacity-20" style={{ color }}>{item.title.charAt(0)}</span>
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold leading-tight text-foreground">{item.title}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: color, color: onColor }}>{label}</span>
              <span className="text-[11px] text-muted-foreground">
                {item.type}{item.duration ? ` · ${item.duration}` : ""}{item.year ? ` · ${item.year}` : ""}
              </span>
              {item.ageRating && (
                <span className="rounded border border-border px-1 py-0.5 text-[9px] font-semibold leading-none text-muted-foreground">{item.ageRating}</span>
              )}
            </div>
            {item.synopsis && (
              <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">{item.synopsis}</p>
            )}
          </div>
        </div>

        {/* El porqué: entero, sin recortes. Es por lo que existe la app. */}
        <div className="px-4 pb-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">✦ Por qué te la propongo</p>
          <p className="mt-1 text-[14.5px] leading-relaxed text-foreground/90">{item.reason}</p>

          <button
            onClick={() => void openStreaming(item, avail, { posterUrl: poster })}
            className="mt-4 w-full rounded-full py-3 text-center text-sm font-bold shadow-sm transition-transform active:scale-95"
            style={{ backgroundColor: color, color: onColor }}
          >
            ▶ Ver en {label}
          </button>
          {/* Atribución requerida por TMDB: la disponibilidad es data de JustWatch */}
          <p className="mt-1 text-center text-[9px] text-muted-foreground/80">Disponibilidad: JustWatch</p>
        </div>
      </div>

    </div>
  );
}
