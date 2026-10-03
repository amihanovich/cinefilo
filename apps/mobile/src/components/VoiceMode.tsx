// Modo voz, a la manera de Claude: tocás el botón violeta y entrás a una charla
// hablada. Miru escucha, CORTA SOLA cuando hacés silencio, piensa, te contesta
// en voz alta y vuelve a escuchar. Tocar el orbe mientras habla la interrumpe;
// mientras escucha, corta ya. La "X" sale al hilo, donde quedan las fichas.
//
// Es la única excepción al press-to-stop de la app: acá no hay botón que
// apretar entre turnos, la charla fluye sola.

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Orb, type OrbPhase } from "./Orb";
import { VoiceRecorder, transcribe } from "../lib/stt";
import { speak, stopSpeaking } from "../lib/tts";

export type VoiceTurnResult = { note: string | null; title: string; platform: string };

type State = "listening" | "thinking" | "speaking" | "paused";

const LABEL: Record<State, string> = {
  listening: "Te escucho…",
  thinking: "Buscando la tuya…",
  speaking: "Tocá para interrumpir",
  paused: "Tocá el orbe para hablar",
};

export function VoiceMode({ onTurn, onClose }: {
  onTurn: (text: string) => Promise<VoiceTurnResult | null>;
  onClose: () => void;
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
      setHint("No pude abrir el micrófono. Habilitá el permiso y tocá el orbe.");
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
    if (blob.size < 500) { setState("paused"); setHint("No te escuché. Tocá el orbe para seguir."); return; }
    let text = "";
    try { text = (await transcribe(blob)).trim(); } catch { /* abajo */ }
    if (genRef.current !== gen) return;
    if (!text) { setState("paused"); setHint("No te entendí. Tocá el orbe y probá de nuevo."); return; }
    setHeard(text);
    setAnswer(null);
    const res = await onTurn(text);
    if (genRef.current !== gen) return;
    if (!res) { setState("paused"); setHint("Se me trabó. Tocá el orbe y probá de nuevo."); return; }
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

  const tapOrb = () => {
    if (state === "listening") void finish(genRef.current); // cortar ya
    else if (state === "speaking" || state === "paused") void listen(); // interrumpir / retomar
  };

  const close = () => {
    genRef.current++;
    recRef.current?.cancel();
    recRef.current = null;
    stopSpeaking();
    onClose();
  };

  const phase: OrbPhase = state === "paused" ? "idle" : state;

  return (
    <div className="fade-in fixed inset-0 z-50 flex flex-col bg-background safe-top safe-bottom">
      <div className="flex shrink-0 justify-end px-5 pt-4">
        <button onClick={close} aria-label="Salir del modo voz" className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-foreground/70 active:scale-90">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 text-center">
        <button onClick={tapOrb} aria-label={LABEL[state]} className="active:scale-95 transition-transform" style={{ WebkitTapHighlightColor: "transparent" }}>
          <Orb phase={phase} size="full" sizePx={200} volume={volume} />
        </button>
        <p className="text-[15px] font-semibold text-foreground/80" data-testid="voice-state">{LABEL[state]}</p>
        {hint && <p className="max-w-xs text-[13px] text-muted-foreground">{hint}</p>}
        {heard && <p className="max-w-sm text-[14px] italic text-muted-foreground">«{heard}»</p>}
        {answer && (
          <div className="max-w-sm">
            <p className="text-[18px] font-bold leading-tight text-foreground">{answer.title}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">en {answer.platform} · la ficha te queda en la charla</p>
          </div>
        )}
      </div>
    </div>
  );
}
