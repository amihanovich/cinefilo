// Modo voz. La sensación es la del modo voz que la gente ya conoce (el de
// Claude): la pantalla se aclara, la marca y una frase grande al centro, un
// brillo que sube desde abajo y late con tu voz, el micrófono flotando y los
// controles de siempre en la fila de abajo. La identidad es de Miru: brillo
// violeta-lavanda, el orbe como marca, y en vez del selector de modelo, dónde
// busca.
//
// Comportamiento: Miru escucha, CORTA SOLA cuando hacés silencio, piensa, te
// contesta en voz alta y vuelve a escuchar. El mic del medio pausa o retoma
// (y si Miru está hablando, la interrumpe). La X vuelve al hilo con las fichas.
// Es la única excepción al press-to-stop de la app.

import { useEffect, useRef, useState } from "react";
import { X, Plus, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { Orb, type OrbPhase } from "./Orb";
import { PlatformIcon } from "./PlatformIcon";
import { VoiceRecorder, transcribe } from "../lib/stt";
import { speak, stopSpeaking } from "../lib/tts";
import { isAllPlatforms } from "../lib/prefs";

export type VoiceTurnResult = { note: string | null; title: string; platform: string };

type State = "listening" | "thinking" | "speaking" | "paused";

const HEADLINE: Record<State, string> = {
  listening: "Te escucho",
  thinking: "Buscando la tuya…",
  speaking: "",
  paused: "Hablemos",
};

export function VoiceMode({
  onTurn, onClose, platforms, onOpenPlatforms, ttsMuted, onToggleMute,
}: {
  onTurn: (text: string) => Promise<VoiceTurnResult | null>;
  onClose: () => void;
  platforms: string[];
  onOpenPlatforms: () => void;
  ttsMuted: boolean;
  onToggleMute: () => void;
}) {
  const [state, setState] = useState<State>("listening");
  const [volume, setVolume] = useState(0);
  const [heard, setHeard] = useState<string | null>(null);
  const [answer, setAnswer] = useState<VoiceTurnResult | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const recRef = useRef<VoiceRecorder | null>(null);
  // Cada vuelta del loop tiene su generación: si el usuario interrumpe o
  // cierra, lo que quedó en vuelo de la vuelta vieja no sigue.
  const genRef = useRef(0);

  const listen = async () => {
    const gen = ++genRef.current;
    stopSpeaking();
    recRef.current?.cancel();
    setHint(null);
    setVolume(0);
    setState("listening");
    const rec = new VoiceRecorder();
    recRef.current = rec;
    try {
      await rec.start({
        autoStop: true,
        silenceMs: 1400,
        onVolume: (v) => { if (genRef.current === gen) setVolume(v); },
        onAutoStop: () => { if (genRef.current === gen) void finish(gen); },
      });
    } catch {
      if (genRef.current !== gen) return;
      recRef.current = null;
      setState("paused");
      setHint("No pude abrir el micrófono. Habilitá el permiso y tocá el micrófono.");
    }
  };

  const finish = async (gen: number) => {
    const rec = recRef.current;
    if (!rec || genRef.current !== gen) return;
    recRef.current = null;
    setVolume(0);
    setState("thinking");
    const blob = await rec.stop();
    if (genRef.current !== gen) return;
    if (blob.size < 500) { setState("paused"); setHint("No te escuché. Tocá el micrófono para seguir."); return; }
    let text = "";
    try { text = (await transcribe(blob)).trim(); } catch { /* abajo */ }
    if (genRef.current !== gen) return;
    if (!text) { setState("paused"); setHint("No te entendí. Tocá el micrófono y probá de nuevo."); return; }
    setHeard(text);
    setAnswer(null);
    const res = await onTurn(text);
    if (genRef.current !== gen) return;
    if (!res) { setState("paused"); setHint("Se me trabó. Tocá el micrófono y probá de nuevo."); return; }
    setAnswer(res);
    setState("speaking");
    await speak(res.note || `Te propongo ${res.title}, en ${res.platform}.`);
    if (genRef.current !== gen) return;
    void listen(); // la charla sigue sola
  };

  useEffect(() => {
    void listen();
    return () => {
      genRef.current++;
      recRef.current?.cancel();
      recRef.current = null;
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // El mic del medio: pausa mientras escucha, retoma si está en pausa, y si
  // Miru está hablando la interrumpe para que hables vos.
  const tapMic = () => {
    if (state === "listening") {
      genRef.current++;
      recRef.current?.cancel();
      recRef.current = null;
      setVolume(0);
      setHint(null);
      setState("paused");
    } else if (state === "speaking" || state === "paused") {
      void listen();
    }
  };
  // Tocar la marca/la frase mientras escuchás = "ya terminé" (no esperar el silencio).
  const tapCenter = () => {
    if (state === "listening") void finish(genRef.current);
    else if (state === "speaking") void listen();
  };

  const close = () => {
    genRef.current++;
    recRef.current?.cancel();
    recRef.current = null;
    stopSpeaking();
    onClose();
  };

  const phase: OrbPhase = state === "paused" ? "idle" : state;
  const all = isAllPlatforms(platforms);
  // El brillo sube con tu voz mientras escucha y respira mientras Miru piensa o habla.
  const lift = state === "listening" ? 1 + Math.min(volume * 6, 0.9) : 1;
  const headline = state === "speaking" && answer ? answer.title : HEADLINE[state];

  return (
    <div className="fade-in fixed inset-0 z-50 overflow-hidden bg-background safe-top safe-bottom">
      {/* El brillo de abajo: violeta-lavanda, late con la voz. */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 bottom-0 h-[52vh] ${state === "thinking" || state === "speaking" ? "miru-breath" : ""}`}
        style={{
          background: "radial-gradient(130% 75% at 50% 100%, rgba(120, 96, 232, 0.42) 0%, rgba(150, 160, 245, 0.26) 38%, rgba(196, 190, 250, 0.10) 62%, transparent 80%)",
          transform: state === "listening" ? `scaleY(${lift})` : undefined,
          transformOrigin: "50% 100%",
          transition: "transform 120ms linear, opacity 400ms ease",
          opacity: state === "paused" ? 0.45 : 1,
        }}
      />

      <div className="relative flex h-full flex-col">
        <div className="flex-1" />

        {/* La marca y la frase, al centro. */}
        <button onClick={tapCenter} className="mx-auto flex max-w-sm flex-col items-center gap-5 px-8 text-center" style={{ WebkitTapHighlightColor: "transparent" }}>
          <Orb phase={phase} size="mini" sizePx={64} volume={volume} />
          <h1 className="font-serif text-[34px] font-bold leading-tight tracking-tight text-foreground" data-testid="voice-state">
            {headline}
          </h1>
          {state === "speaking" && answer && (
            <p className="-mt-3 text-[13px] text-muted-foreground">en {answer.platform} · la ficha te queda en la charla</p>
          )}
          {state === "thinking" && heard && <p className="-mt-3 text-[14px] italic text-muted-foreground">«{heard}»</p>}
          {hint && <p className="-mt-2 text-[13px] text-muted-foreground">{hint}</p>}
        </button>

        <div className="flex-1" />

        {/* El micrófono flotando, y abajo la fila de siempre. */}
        <div className="flex justify-center pb-5">
          <button
            onClick={tapMic}
            aria-label={state === "listening" ? "Pausar el micrófono" : "Hablar"}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-card text-foreground shadow-[0_4px_18px_rgba(60,40,140,0.18)] ring-1 ring-border transition-transform active:scale-90"
          >
            {state === "paused" ? <MicOff className="h-6 w-6 text-muted-foreground" /> : <Mic className="h-6 w-6" />}
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 pb-4">
          <button onClick={onOpenPlatforms} aria-label="Elegir dónde buscar" className="flex h-12 w-12 items-center justify-center rounded-full bg-card text-foreground/80 shadow-sm ring-1 ring-border active:scale-90">
            <Plus className="h-5 w-5" />
          </button>
          <button
            onClick={onOpenPlatforms}
            aria-label={all ? "Buscando en todas las plataformas" : `Buscando en ${platforms.join(", ")}`}
            className="flex h-12 items-center gap-1.5 rounded-full bg-card px-4 shadow-sm ring-1 ring-border active:scale-95"
          >
            {all ? (
              <span className="text-[15px] font-semibold text-foreground">Todas</span>
            ) : (
              <span className="flex items-center gap-1">
                {platforms.map((p) => <PlatformIcon key={p} platform={p} size={20} />)}
              </span>
            )}
          </button>
          <div className="flex-1" />
          <button onClick={onToggleMute} aria-label={ttsMuted ? "Activar la voz de Miru" : "Silenciar la voz de Miru"} className="flex h-12 w-12 items-center justify-center rounded-full bg-card text-foreground/80 shadow-sm ring-1 ring-border active:scale-90">
            {ttsMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
          <button onClick={close} aria-label="Salir del modo voz" className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm active:scale-90">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
