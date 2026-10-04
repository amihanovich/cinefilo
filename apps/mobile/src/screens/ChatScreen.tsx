// Miru conversacional: la app ES la charla. Le pedís algo (voz o texto) y te
// devuelve UNA película, bien justificada — como el experto del videoclub.
// Todo lo demás (grilla, tops, Mi lista, control de TV) queda como capa
// guardada en el repo; acá solo entra lo que sirve a la conversación.
//
// Regla de voz: "habla si le hablaste". Si el pedido entró por voz, Miru
// contesta hablado; si lo escribiste, contesta escrito.
//
// La memoria (lib/taste.ts): cada pedido, cada apertura, cada descarte con lo
// que dijiste, las manitos y el "¿qué tal estuvo?" al volver son señales; el
// backend las sintetiza en un perfil de gusto que viaja con cada pedido. Es lo
// que permite que la carta diga "como la última vez te fuiste con X…".

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { User, Volume2, VolumeX, RefreshCw, ThumbsUp, ThumbsDown, Eye, Check } from "lucide-react";
import { MiruMark } from "../components/MiruMark";
import { Composer, type DictationState } from "../components/Composer";
import { PlatformSheet } from "../components/PlatformSheet";
import { VoiceMode, type VoiceTurnResult } from "../components/VoiceMode";
import { LoginSheet } from "../components/LoginSheet";
import { startTasteSync, stopTasteSync } from "../lib/tasteSync";
import { currentUser, onUserChange, signInWithGoogle, signOut, deleteAccount, takePendingAsk, rememberPendingAsk, freeUsesLeft, spendFreeUse, FREE_USES, type MiruUser } from "../lib/auth";
import { BrandSplash } from "../components/BrandSplash";
import { ProfileSheet } from "../components/ProfileSheet";
import { ControlScreen } from "./ControlScreen";
import { fetchRecommendation, fetchPosters, warmupBackend, type Message, type Recommendation } from "../lib/api";
import { inferContext, contextToPromptHint, seasonHintShort } from "../lib/context";
import { colorForPlatform, platformLabel, textOnPlatform } from "../lib/deeplink";
import { jwSearch, type JwResult } from "../lib/justwatch";
import { openStreaming } from "../lib/watch";
import { VoiceRecorder, transcribe } from "../lib/stt";
import { speak, stopSpeaking, isMuted, setMuted } from "../lib/tts";
import {
  PLATFORMS, loadPlatforms, seedPlatforms, savePlatforms, detectCountry, getCountry, getName, timeGreeting,
  loadMode, saveMode, modeLabel, type ModeId, loadIncludeSeen, saveIncludeSeen,
} from "../lib/prefs";
import { pickTvSession } from "../lib/tv-remote";
import { track } from "../lib/analytics";
import { useBackLayer } from "../lib/back";
import {
  recordSession, recordRequest, recordRejection, recordVerdict, recordShown, cardVerdict, isSeen, setSeen,
  pendingVerdict, markAsked, excludeTitles as tasteExclude, profileBlock, hasProfile, maybeRefreshProfile,
  addNote, removeNote, loadTaste, purgeAutoNotes,
  type Verdict,
} from "../lib/taste";

// El saludo es a la manera de Claude: la marca y una frase grande al centro
// ("Buenas tardes, Agus"), no una burbuja. Debajo, una línea que cambia según
// si Miru ya te conoce.
const SUB_FIRST = "Soy Miru. Decime qué tenés ganas de ver y te elijo una.";
const SUB_BACK = "¿Qué tenés ganas de ver?";
const SPLASH_MSG = "Rastrillando las plataformas para encontrar lo tuyo…";
// Ejemplos tocables (anti-parálisis): muestran QUÉ se le puede pedir.
const EXAMPLES = ["Algo de terror liviano", "Una comedia para reír", "Algo corto y bueno"];

type Turn =
  | { kind: "miru"; id: string; text: string; tone?: "question" | "error" }
  | { kind: "user"; id: string; text: string }
  | { kind: "reco"; id: string; item: Recommendation }
  | { kind: "thinking"; id: string }
  /** "¿Qué tal estuvo X?" al volver: tres chips, una sola vez por título. */
  | { kind: "verdict"; id: string; title: string }
  /** "Acordate que…": lo que Miru guardó en la memoria, con Deshacer. */
  | { kind: "memory"; id: string; text: string; noteId: string | null };

// Cómo arranca el hilo: vacío (el saludo es el encabezado grande), salvo que en
// otra sesión hayas abierto algo — ahí Miru pregunta qué tal estuvo, que es la
// señal que más afina el perfil.
function openingTurns(): Turn[] {
  const pending = pendingVerdict();
  if (pending) {
    return [
      { kind: "miru", id: uid(), text: `La última vez te llevaste ${pending.title}. ¿Qué tal estuvo?` },
      { kind: "verdict", id: uid(), title: pending.title },
    ];
  }
  return [];
}

let seq = 0;
const uid = () => `t${++seq}`;

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function ChatScreen() {
  const [phase, setPhase] = useState<"splash" | "chat">("splash");
  const [turns, setTurns] = useState<Turn[]>(openingTurns);
  const [platforms, setPlatforms] = useState<string[]>(loadPlatforms);
  // Modo de búsqueda (las "habilidades" del +): queda puesto hasta que lo saques.
  const [mode, setMode] = useState<ModeId | null>(loadMode);
  const [includeSeen, setIncludeSeen] = useState<boolean>(loadIncludeSeen);
  const [posters, setPosters] = useState<Record<string, string | null>>({});
  const [brokenPosters, setBrokenPosters] = useState<Set<string>>(new Set());
  const [availability, setAvailability] = useState<Record<string, JwResult>>({});
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [micState, setMicState] = useState<DictationState>("idle");
  const [platformsOpen, setPlatformsOpen] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [user, setUser] = useState<MiruUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  // La memoria de la cuenta ya bajó (o no había cuenta): recién ahí se retoma
  // un pedido pendiente, así la primera recomendación ya te conoce.
  const [memoryReady, setMemoryReady] = useState(false);
  const [login, setLogin] = useState<{ reason: "limit" | "manual"; pending: string | null } | null>(null);
  const [usesLeft, setUsesLeft] = useState(freeUsesLeft);
  // El nombre sale de la cuenta de Google; sin cuenta, el que hayas dado antes (si hay).
  const name = user?.firstName ?? getName();
  const [ttsMuted, setTtsMuted] = useState(() => { try { return isMuted(); } catch { return false; } });
  const [accountOpen, setAccountOpen] = useState(false);
  const [controlSession, setControlSession] = useState<string | null>(null);

  // El historial de la conversación viaja al backend en cada turno (los
  // refinamientos —"más corta", "algo más liviano"— salen gratis de ahí). Va en
  // un ref: no se renderiza, y así ningún callback lo lee desactualizado.
  const historyRef = useRef<Message[]>([]);
  const shownRef = useRef<Set<string>>(new Set()); // títulos ya propuestos → excludeTitles
  const openedRef = useRef<Set<string>>(new Set()); // los que abriste en esta charla (no cuentan como descarte)
  // Descartes de ESTA charla, con lo que dijiste como motivo: viajan al backend
  // (restricción dura para el próximo pick) y a la memoria.
  const rejectedRef = useRef<{ title: string; reason: string | null }[]>([]);
  const busyRef = useRef(false);
  const micRef = useRef<VoiceRecorder | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  // Turno al que saltar cuando llega la respuesta: con la ficha larga, ir al
  // final del hilo dejaba al usuario mirando el botón en vez del título.
  const anchorRef = useRef<string | null>(null);
  const lastRecoRef = useRef<Recommendation | null>(null);
  const userRef = useRef<MiruUser | null>(null);
  userRef.current = user; // askMiru lo lee sin quedar atado a un render viejo

  const lastReco = [...turns].reverse().find((t): t is Extract<Turn, { kind: "reco" }> => t.kind === "reco");

  // La cuenta: sesión guardada, vuelta de Google (?code=… lo canjea el cliente)
  // y cambios (login / logout).
  useEffect(() => {
    let alive = true;
    const sync = (u: MiruUser | null) => {
      if (!u) { setMemoryReady(true); return; }
      void startTasteSync(u.id).then((pulled) => {
        if (!alive) return;
        if (pulled) setPlatforms(loadPlatforms()); // tus plataformas vienen con la cuenta
        setMemoryReady(true);
      });
    };
    void currentUser().then((u) => { if (alive) { setUser(u); setAuthReady(true); sync(u); } });
    const off = onUserChange((u) => {
      setUser(u);
      setAuthReady(true);
      if (u) sync(u);
      if (u) {
        setLogin(null);
        track("login_success");
        // Limpia el ?code= de la URL después del canje.
        try {
          const url = new URL(window.location.href);
          if (url.searchParams.has("code")) { url.searchParams.delete("code"); window.history.replaceState(window.history.state, "", url.toString()); }
        } catch { /* noop */ }
      }
    });
    return () => { alive = false; off(); };
  }, []);

  // Splash corto: cubre el cold start de Railway y el saludo queda listo abajo.
  useEffect(() => {
    seedPlatforms();
    void detectCountry();
    warmupBackend();
    purgeAutoNotes();
    recordSession();
    // Si Miru va a preguntar por la última apertura, ya queda marcado: se
    // pregunta una sola vez, conteste o no.
    const pending = pendingVerdict();
    if (pending) markAsked(pending.title);
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
  // Devuelve lo que el modo voz necesita para hablar (null si falló). La voz la
  // pone VoiceMode, que sabe cuándo termina para volver a escuchar.
  const askMiru = useCallback(async (raw: string, source: "text" | "voice", opts?: { dry?: boolean }): Promise<VoiceTurnResult | null> => {
    const q = raw.trim();
    if (!q || busyRef.current) return null;
    // Sin cuenta y sin usos de prueba: en vez de buscar, "Creá tu cuenta". Lo que
    // pediste queda guardado y se busca solo al volver de Google.
    if (!userRef.current && freeUsesLeft() <= 0) {
      track("login_gate_shown", { source });
      setVoiceMode(false);
      setLogin({ reason: "limit", pending: q });
      return null;
    }
    busyRef.current = true;
    setBusy(true);
    stopSpeaking();

    const turnNumber = historyRef.current.filter((m) => m.role === "user").length + 1;
    track("chat_turn", { source, turn_number: turnNumber });

    // Pedir otra cosa con una película en pantalla que no abriste ES un
    // descarte, y lo que dijiste es el motivo ("muy larga", "algo más liviano").
    // "Dame otra" a secas es un descarte sin motivo. Si le pusiste 👍 o "Ya la
    // vi", no cuenta: no es que no le cerró.
    const prev = lastRecoRef.current;
    if (prev && !openedRef.current.has(prev.title) && cardVerdict(prev.title) !== "liked" && !isSeen(prev.title) &&
        !rejectedRef.current.some((r) => r.title === prev.title)) {
      const reason = opts?.dry ? null : q;
      rejectedRef.current = [...rejectedRef.current, { title: prev.title, reason }];
      recordRejection(prev.title, reason);
    }
    recordRequest(q, source);

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
        // Lo de esta charla + lo visto/abierto en 30 días: nunca "ya me la sugeriste".
        excludeTitles: [...new Set([...tasteExclude(includeSeen), ...shownRef.current])].slice(-60),
        alternativesCount: 0, // modo "una sola": el porqué largo es el producto
        country: getCountry(),
        tasteProfile: profileBlock(includeSeen),
        userName: name,
        rejected: rejectedRef.current.slice(-8),
        mode,
      });

      // "Acordate que…": lo que pidió recordar va a la memoria (manda sobre el
      // perfil) y queda a la vista con Deshacer.
      const remember = (data?.remember ?? "").trim();
      let memoryTurn: Turn | null = null;
      if (remember) {
        addNote(remember, "chat");
        const saved = loadTaste().notes.find((n) => n.text.toLowerCase() === remember.toLowerCase());
        memoryTurn = { kind: "memory", id: uid(), text: remember, noteId: saved?.id ?? null };
        track("memory_note_added", { source: "chat" });
      }

      // Solo pidió que recuerde algo (sin pedir película): Miru acusa recibo y listo.
      if (!data?.main?.title && remember) {
        const ack = (data.cinephile_note ?? "").trim() || "Anotado, lo voy a tener en cuenta.";
        historyRef.current = [...history, { role: "assistant", content: ack }];
        const ackId = uid();
        anchorRef.current = ackId;
        setTurns((prev) => [
          ...prev.filter((t) => t.kind !== "thinking"),
          { kind: "miru", id: ackId, text: ack },
          ...(memoryTurn ? [memoryTurn] : []),
        ]);
        // En el modo voz va como "repregunta": Miru lo dice y sigue escuchando.
        return { note: null, title: "", platform: "", question: ack };
      }

      const main = data?.main;
      if (!main?.title) throw new Error("sin resultado");

      shownRef.current.add(main.title);
      lastRecoRef.current = main;
      // Cuenta solo la recomendación que salió bien (errores no gastan).
      if (!userRef.current) { spendFreeUse(); setUsesLeft(freeUsesLeft()); }
      recordShown(main.title);
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
        ...(memoryTurn ? [memoryTurn] : []),
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


      // El póster de TMDB viaja con la película; solo si el backend no lo
      // resolvió se busca desde el teléfono (Cinemeta/iTunes/Wikipedia).
      if (!main.posterUrl) {
        void fetchPosters([{ title: main.title, type: main.type, year: main.year }])
          .then((p) => setPosters((prev) => ({ ...prev, ...p })));
      }
      void jwSearch(main.title, main.platform, main.type, getCountry())
        .then((r) => setAvailability((prev) => ({ ...prev, [main.title]: r })))
        .catch(() => { /* sin verificar: el botón cae a buscar en la plataforma */ });
      return { note: note || null, title: main.title, platform: platformLabel(main.platform), question: question || null };
    } catch (e) {
      console.error("[chat]", e);
      // Tres fallas distintas, tres mensajes: el genérico escondía cuál era.
      const err = e as { name?: string; status?: number };
      const msg =
        err?.name === "TimeoutError" ? "Me demoré demasiado eligiendo. Pedímelo de nuevo, ya lo tengo más a mano."
        : err?.name === "HttpError" ? `Se me trabó la elección (error ${err.status}). Probá de nuevo en un toque.`
        : "No llego al servidor. Fijate la conexión y pedímelo de nuevo.";
      track("chat_turn_failed", { kind: err?.name ?? "unknown", status: err?.status ?? null });
      setTurns((prev) => [
        ...prev.filter((t) => t.kind !== "thinking"),
        { kind: "miru", id: uid(), text: msg, tone: "error" },
      ]);
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
      // La memoria se re-sintetiza en segundo plano cuando juntó señales.
      void maybeRefreshProfile();
    }
  }, [platforms, name, mode, includeSeen]);

  const send = () => {
    const q = text.trim();
    if (!q) return;
    setText("");
    void askMiru(q, "text");
  };

  const another = () => {
    track("another_requested");
    void askMiru("Esa no me convence, dame otra", "text", { dry: true });
  };

  // "¿Qué tal estuvo X?": la respuesta reemplaza los chips por un acuse corto.
  const answerVerdict = (turnId: string, title: string, verdict: Verdict) => {
    recordVerdict(title, verdict, "return");
    track("verdict_given", { verdict, stage: "return" });
    const ack = verdict === "liked" ? "Anotado. Eso me sirve para la próxima."
      : verdict === "meh" ? "Anotado, gracias por decírmelo: la próxima afino."
      : "Dale, la dejamos ahí. ¿Qué tenés ganas de ver hoy?";
    setTurns((prev) => prev.map((t) => (t.id === turnId ? { kind: "miru", id: turnId, text: ack } as Turn : t)));
    void maybeRefreshProfile();
  };

  // 👍/👎 en la ficha: reacción a la propuesta (todavía no la viste). Señal de
  // gusto declarado; el swap sigue siendo "Dame otra" o decirle qué no cerró.
  const reactToCard = (title: string, verdict: Verdict) => {
    recordVerdict(title, verdict, "card");
    track("verdict_given", { verdict, stage: "card" });
    void maybeRefreshProfile();
  };

  // "Ya la vi": marca aparte de la manito (pueden ir juntas). Saca el título
  // de las próximas propuestas salvo "Incluir ya vistas".
  const markSeen = (title: string, on: boolean) => {
    setSeen(title, on);
    track("seen_marked", { on });
    if (on) void maybeRefreshProfile();
  };

  // ── Dictado (el mic del composer): press-to-speak / press-to-stop ─────────
  // Como el mic de Claude: pasa lo que dijiste al cuadro y vos decidís si lo
  // mandás. Para charlar hablado está el modo voz (el botón violeta).
  const toggleMic = async () => {
    if (micState === "rec") {
      const rec = micRef.current;
      micRef.current = null;
      setMicState("processing");
      if (!rec) { setMicState("idle"); return; }
      const blob = await rec.stop();
      if (blob.size < 500) { setMicState("idle"); return; }
      try {
        const heard = (await transcribe(blob)).trim();
        if (heard) setText((prev) => (prev.trim() ? `${prev.trim()} ${heard}` : heard));
      } catch {
        say("No te escuché bien. Probá de nuevo o escribime.", "error");
      }
      setMicState("idle");
      return;
    }
    if (micState !== "idle") return;
    setMicState("requesting");
    const rec = new VoiceRecorder();
    micRef.current = rec;
    try {
      await rec.start({ autoStop: false });
      setMicState("rec");
    } catch {
      micRef.current = null;
      setMicState("idle");
      say("No pude abrir el micrófono. Habilitá el permiso, o escribime acá abajo.", "error");
    }
  };

  const voiceResult = (res: VoiceTurnResult) => {
    setVoiceMode(false);
    // Después del desmontaje del modo voz (que corta cualquier voz en curso).
    window.setTimeout(() => { void speak(res.note || `Te propongo ${res.title}, en ${res.platform}.`); }, 80);
  };

  const changePlatforms = (next: string[]) => {
    setPlatforms(next);
    savePlatforms(next);
    track("platforms_changed", { count: next.length, all: next.length === PLATFORMS.length });
  };

  const changeMode = (next: ModeId | null) => {
    setMode(next);
    saveMode(next);
    track("mode_changed", { mode: next });
  };

  const changeIncludeSeen = (next: boolean) => {
    setIncludeSeen(next);
    saveIncludeSeen(next);
    track("include_seen_changed", { on: next });
  };

  const undoMemory = (turnId: string, noteId: string | null) => {
    if (noteId) removeNote(noteId);
    track("memory_note_undone");
    setTurns((prev) => prev.filter((t) => t.id !== turnId));
  };

  const toggleMute = () => {
    const next = !ttsMuted;
    setTtsMuted(next);
    setMuted(next); // persiste + corta lo que esté sonando
  };

  const openTvRemote = async () => {
    track("tv_remote_open");
    const id = await pickTvSession(() => say("Ese código no me sirve. Mirá el que está debajo del QR.", "error"));
    if (id) setControlSession(id);
  };

  useEffect(() => {
    if (!user || phase !== "chat" || !memoryReady) return;
    const pending = takePendingAsk();
    if (pending) void askMiru(pending, "text");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, phase, memoryReady]);

  useBackLayer(accountOpen, () => setAccountOpen(false));
  useBackLayer(!!login, () => setLogin(null));
  useBackLayer(platformsOpen, () => setPlatformsOpen(false));
  useBackLayer(voiceMode, () => setVoiceMode(false));
  useBackLayer(!!controlSession, () => setControlSession(null));

  if (controlSession) {
    return <ControlScreen session={controlSession} onClose={() => setControlSession(null)} />;
  }
  if (phase === "splash") return <BrandSplash message={SPLASH_MSG} />;

  // Hilo "fresco" = todavía no pediste nada: saludo centrado + ejemplos.
  const fresh = !turns.some((t) => t.kind === "user");

  return (
    <div className="flex h-[100dvh] flex-col bg-background safe-top safe-bottom">
      <ProfileSheet
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        onOpenTvRemote={() => { setAccountOpen(false); void openTvRemote(); }}
        user={user}
        onSignIn={() => { setAccountOpen(false); setLogin({ reason: "manual", pending: null }); }}
        onDeleteAccount={() => {
          if (!window.confirm("¿Borrar tu cuenta? Se borran tu cuenta y todo lo que Miru sabe de tus gustos. No se puede deshacer.")) return;
          setAccountOpen(false);
          void deleteAccount().then(async (err) => {
            if (err) { say(err, "error"); return; }
            track("account_deleted");
            await stopTasteSync(false);
            setTurns([]);
            historyRef.current = [];
            shownRef.current = new Set();
            rejectedRef.current = [];
            lastRecoRef.current = null;
          });
        }}
        onSignOut={() => {
          setAccountOpen(false);
          // Se sube lo último, el teléfono queda limpio y la charla arranca de cero.
          void stopTasteSync().then(() => signOut()).then(() => {
            setTurns([]);
            historyRef.current = [];
            shownRef.current = new Set();
            rejectedRef.current = [];
            lastRecoRef.current = null;
            setPlatforms(loadPlatforms());
          });
        }}
      />

      {/* Header: la marca, el mute de la voz y UNA puerta a los ajustes (que es
          donde vive también "Conectar TV" — la capa de TV no desaparece, deja
          de ocupar la pantalla). */}
      <div className="flex shrink-0 items-center justify-between px-5 pt-5 pb-2">
        <div className="flex items-center gap-1.5">
          <MiruMark size={18} />
          <span className="font-serif text-[17px] font-bold text-foreground">Miru</span>
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
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt={user.name ?? "Mi cuenta"} referrerPolicy="no-referrer" className="h-9 w-9 rounded-full object-cover" />
            ) : (
              <User className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* El hilo */}
      <div className={cn(
        "flex-1 min-h-0 overflow-y-auto px-5 pb-4",
        fresh && "flex flex-col justify-center",
      )}>
        {fresh && (
          <div className="fade-in mb-6 flex flex-col items-center text-center">
            <MiruMark size={44} state="idle" />
            <h1 className="mt-4 font-serif text-[32px] font-bold leading-tight tracking-tight text-foreground" data-testid="greeting">
              {timeGreeting()}{name ? `, ${name}` : ""}
            </h1>
            <p className="mt-1.5 text-[15px] text-muted-foreground">{hasProfile() ? SUB_BACK : SUB_FIRST}</p>
            {!user && authReady && (
              <button onClick={() => setLogin({ reason: "manual", pending: null })} className="mt-2 text-[13px] font-semibold text-primary">
                Iniciar sesión
              </button>
            )}
          </div>
        )}
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
                <span className="mt-1.5 flex h-7 w-7 shrink-0 items-center justify-center">
                  <MiruMark size={20} />
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
          if (t.kind === "memory") {
            return (
              <div key={t.id} data-testid="memory-chip" className="fade-in mt-2 flex items-center gap-2 pl-9">
                <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-[12px] text-foreground">
                  <Check className="h-3.5 w-3.5 text-primary" /> Lo voy a recordar: {t.text}
                </span>
                <button onClick={() => undoMemory(t.id, t.noteId)} className="text-[12px] font-semibold text-muted-foreground underline">
                  Deshacer
                </button>
              </div>
            );
          }
          if (t.kind === "verdict") {
            return (
              <div key={t.id} className="fade-in mt-2 flex flex-wrap gap-1.5 pl-9">
                {([["liked", "Me gustó"], ["meh", "No tanto"], ["unseen", "No la vi"]] as [Verdict, string][]).map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => answerVerdict(t.id, t.title, v)}
                    className="rounded-full border border-primary/25 bg-primary/5 px-3 py-1.5 text-[12px] font-semibold text-foreground transition-transform active:scale-95"
                  >
                    {label}
                  </button>
                ))}
              </div>
            );
          }
          if (t.kind === "thinking") {
            return (
              <div key={t.id} className="fade-in mt-4 flex items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center">
                  <MiruMark size={22} state="thinking" />
                </span>
                <span className="text-[14px] text-muted-foreground">Buscando la tuya…</span>
              </div>
            );
          }
          return (
            <RecoCard
              key={t.id}
              turnId={t.id}
              item={t.item}
              poster={(t.item.posterUrl && !brokenPosters.has(t.item.posterUrl) ? t.item.posterUrl : null) ?? posters[t.item.title]}
              onPosterError={(url) => {
                // La imagen de TMDB no cargó (red, bloqueo): se marca rota y se
                // busca desde el teléfono, como antes.
                setBrokenPosters((prev) => new Set(prev).add(url));
                if (!(t.item.title in posters)) {
                  void fetchPosters([{ title: t.item.title, type: t.item.type, year: t.item.year }])
                    .then((p) => setPosters((prev) => ({ ...prev, ...p })));
                }
              }}
              avail={availability[t.item.title]}
              onOpened={() => openedRef.current.add(t.item.title)}
              onReact={(v) => reactToCard(t.item.title, v)}
              onSeen={(on) => markSeen(t.item.title, on)}
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
        {fresh && (
          <div className="mt-5 flex flex-wrap justify-center gap-1.5">
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

      {/* Composer a la manera de Claude: texto, dónde busco, dictado y modo voz. */}
      <div className="shrink-0 bg-background px-3 pb-3 pt-2">
        {authReady && !user && usesLeft <= 1 && (
          <p className="mb-2 text-center text-[12px] text-muted-foreground" data-testid="uses-left">
            {usesLeft === 1 ? "Te queda 1 recomendación sin cuenta." : `Usaste tus ${FREE_USES} recomendaciones de prueba.`}{" "}
            <button onClick={() => setLogin({ reason: usesLeft === 0 ? "limit" : "manual", pending: null })} className="font-semibold text-primary">
              Crear cuenta
            </button>
          </p>
        )}
        <Composer
          value={text}
          onChange={setText}
          onSend={send}
          busy={busy}
          platforms={platforms}
          onOpenPlatforms={() => setPlatformsOpen(true)}
          modeLabel={modeLabel(mode)}
          onClearMode={() => changeMode(null)}
          dictation={micState}
          onDictate={() => void toggleMic()}
          onVoiceMode={() => { track("voice_mode_open"); stopSpeaking(); setVoiceMode(true); }}
        />
      </div>

      {voiceMode && (
        <VoiceMode
          onTurn={(heard) => askMiru(heard, "voice")}
          onResult={voiceResult}
          onClose={() => setVoiceMode(false)}
          name={name}
          platforms={platforms}
          onOpenPlatforms={() => setPlatformsOpen(true)}
          ttsMuted={ttsMuted}
          onToggleMute={toggleMute}
        />
      )}

      <LoginSheet
        open={!!login}
        reason={login?.reason ?? "manual"}
        onSignIn={() => signInWithGoogle(login?.pending ?? null)}
        onBeforeEmailAuth={() => rememberPendingAsk(login?.pending ?? null)}
        onClose={() => setLogin(null)}
      />

      {/* Después del modo voz: el selector se abre también desde ahí, encima. */}
      <PlatformSheet
        open={platformsOpen}
        selected={platforms}
        onChange={changePlatforms}
        mode={mode}
        onModeChange={changeMode}
        includeSeen={includeSeen}
        onIncludeSeenChange={changeIncludeSeen}
        onClose={() => setPlatformsOpen(false)}
      />
    </div>
  );
}

// ── La película ──────────────────────────────────────────────────────────────
// Una sola, con el porqué entero. El póster acompaña; el texto es el producto.
function RecoCard({
  turnId, item, poster, avail, onOpened, onReact, onSeen, onPosterError,
}: {
  onPosterError: (url: string) => void;
  turnId: string;
  item: Recommendation;
  poster?: string | null;
  avail?: JwResult;
  onOpened: () => void;
  onReact: (verdict: Verdict) => void;
  onSeen: (on: boolean) => void;
}) {
  const [reaction, setReaction] = useState<Verdict | null>(() => cardVerdict(item.title));
  const [seen, setSeenState] = useState<boolean>(() => isSeen(item.title));
  const react = (v: Verdict) => { setReaction(v); onReact(v); };
  const toggleSeen = () => { const on = !seen; setSeenState(on); onSeen(on); };
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
              <img src={poster} alt={item.title} className="h-full w-full object-cover" onError={() => onPosterError(poster)} />
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
            onClick={() => { onOpened(); void openStreaming(item, avail, { posterUrl: poster }); }}
            className="mt-4 w-full rounded-full py-3 text-center text-sm font-bold shadow-sm transition-transform active:scale-95"
            style={{ backgroundColor: color, color: onColor }}
          >
            ▶ Ver en {label}
          </button>
          {/* Atribución requerida por TMDB: la disponibilidad es data de JustWatch */}
          <p className="mt-1 text-center text-[9px] text-muted-foreground/80">Disponibilidad: JustWatch</p>

          {/* La manito: reacción a la propuesta (no un veredicto de vista). Alimenta
              el perfil; el swap sigue siendo "Dame otra" o decirle qué no cerró.
              "Ya la vi" va aparte y convive con la manito (ya la vi + me gusta):
              no es gusto, saca el título de las próximas propuestas. */}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1">
            {([
              ["liked", "Me gusta", <ThumbsUp key="i" className="h-3 w-3" />],
              ["meh", "No me gusta", <ThumbsDown key="i" className="h-3 w-3" />],
            ] as [Verdict, string, ReactNode][]).map(([v, label, icon]) => (
              <button
                key={v}
                onClick={() => react(v)}
                aria-label={label}
                aria-pressed={reaction === v}
                className={cn(
                  "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-all active:scale-95",
                  reaction === v ? "bg-primary/10 text-primary" : "text-muted-foreground",
                )}
              >
                {icon} {label}
              </button>
            ))}
            <span className="h-3 w-px bg-border" aria-hidden />
            <button
              onClick={toggleSeen}
              aria-label="Ya la vi"
              aria-pressed={seen}
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-all active:scale-95",
                seen ? "bg-primary/10 text-primary" : "text-muted-foreground",
              )}
            >
              <Eye className="h-3 w-3" /> Ya la vi
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
