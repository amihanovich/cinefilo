import { useState } from "react";
import { Sparkles, ArrowRight, Heart, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { type AgeBracket, markOnboarded, skipOnboarding } from "@/lib/guestSeed";

type Step = 1 | 2;

const AGE_OPTIONS: { value: AgeBracket; label: string; hint: string }[] = [
  { value: "18-29", label: "18–29", hint: "Gen Z / millennials jóvenes" },
  { value: "30-45", label: "30–45", hint: "Millennials / Gen X jóvenes" },
  { value: "46+", label: "46+", hint: "Gen X / boomers" },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>(1);
  const [age, setAge] = useState<AgeBracket | null>(null);
  const [titles, setTitles] = useState<string[]>(["", "", ""]);

  const setTitle = (idx: number, value: string) => {
    setTitles((prev) => prev.map((t, i) => (i === idx ? value : t)));
  };

  const finish = () => {
    const cleaned = titles.map((t) => t.trim()).filter((t) => t.length >= 2);
    markOnboarded(age, cleaned);
    onDone();
  };

  const skip = () => {
    skipOnboarding();
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 px-5 py-8 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mb-3 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            En 20 segundos
          </div>
          <h1 className="font-display text-3xl font-bold leading-tight text-foreground">
            Contanos un poco{" "}
            <span className="text-primary">de vos</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Con esto te proponemos algo afín desde la primera búsqueda.
            No te pedimos nada más.
          </p>
        </div>

        {/* Progreso */}
        <div className="mb-5 flex items-center gap-2">
          <div className="h-1 flex-1 rounded-full bg-border">
            <div
              className="h-1 rounded-full bg-gradient-primary transition-all"
              style={{ width: step === 1 ? "50%" : "100%" }}
            />
          </div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Paso {step} de 2
          </span>
        </div>

        <div className="rounded-3xl border-2 border-primary/40 bg-card p-5 shadow-card">
          {step === 1 && (
            <div>
              <h2 className="text-base font-semibold text-foreground">
                ¿En qué rango de edad estás?
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Nos ayuda con las referencias culturales (no se comparte).
              </p>
              <div className="mt-4 grid gap-2">
                {AGE_OPTIONS.map((opt) => {
                  const active = age === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setAge(opt.value)}
                      className={cn(
                        "flex min-h-[56px] items-center justify-between gap-3 rounded-2xl border px-4 text-left transition-smooth",
                        active
                          ? "border-primary bg-primary/10"
                          : "border-border bg-background hover:border-primary/50",
                      )}
                    >
                      <div>
                        <div className="text-sm font-semibold text-foreground">{opt.label}</div>
                        <div className="text-[11px] text-muted-foreground">{opt.hint}</div>
                      </div>
                      {active && <Check className="h-4 w-4 text-primary" />}
                    </button>
                  );
                })}
              </div>
              <div className="mt-5 flex items-center justify-between gap-3">
                <button
                  onClick={skip}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  Saltar todo
                </button>
                <button
                  onClick={() => setStep(2)}
                  disabled={!age}
                  className={cn(
                    "inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-5 text-sm font-semibold transition-smooth",
                    age
                      ? "bg-gradient-primary text-primary-foreground shadow-primary active:scale-95"
                      : "cursor-not-allowed bg-background text-muted-foreground",
                  )}
                >
                  Siguiente
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="flex items-center gap-1.5 text-base font-semibold text-foreground">
                <Heart className="h-4 w-4 text-primary" />
                Tres títulos que amaste
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Películas o series. Cualquier época. Los usamos para entender tu sensibilidad.
              </p>
              <div className="mt-4 space-y-2">
                {titles.map((t, i) => (
                  <input
                    key={i}
                    value={t}
                    onChange={(e) => setTitle(i, e.target.value)}
                    placeholder={
                      i === 0
                        ? "Ej: Breaking Bad"
                        : i === 1
                          ? "Ej: La La Land"
                          : "Ej: Parasite"
                    }
                    className="min-h-[48px] w-full rounded-2xl border border-border bg-background px-4 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Podés dejar alguno vacío. Con uno o dos ya nos ayudás.
              </p>
              <div className="mt-5 flex items-center justify-between gap-3">
                <button
                  onClick={() => setStep(1)}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  ← Atrás
                </button>
                <button
                  onClick={finish}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-gradient-primary px-5 text-sm font-semibold text-primary-foreground shadow-primary transition-smooth active:scale-95"
                >
                  <Sparkles className="h-4 w-4" />
                  Recomendame algo
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Cerrar */}
        <button
          onClick={skip}
          className="absolute right-5 top-5 inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          aria-label="Cerrar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
