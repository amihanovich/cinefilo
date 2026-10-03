// "Mi cuenta" de la app conversacional. Reemplaza a AccountSheet en esta app
// (AccountSheet sigue para el wizard congelado). Lo que tiene que estar acá es
// lo que hace a la conversación: quién sos, lo que Miru sabe de vos (la
// memoria, editable, como la de Claude) y tu historial. Las plataformas ya no
// van acá: se eligen en cada búsqueda, en el + del composer.

import { useEffect, useState } from "react";
import { X, Plus, Tv, Brain, Trash2 } from "lucide-react";
import {
  loadTaste, addNote, removeNote, removeTag, setMemoryOff, clearMemory, tasteHistory,
} from "../lib/taste";
import { loadOpened } from "../lib/opened";
import { COUNTRIES, getCountry, setCountry } from "../lib/prefs";

type User = { name: string | null; email: string | null; avatarUrl: string | null } | null;

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="mt-7">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} role="switch" aria-checked={on} aria-label={label} className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors ${on ? "bg-primary" : "bg-muted ring-1 ring-border"}`}>
      <span className={`absolute left-0 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
    </button>
  );
}

function Tag({ text, tone, onRemove }: { text: string; tone: "like" | "avoid"; onRemove: () => void }) {
  return (
    <span className={`flex items-center gap-1 rounded-full py-1 pl-3 pr-1 text-[12.5px] ${tone === "like" ? "bg-primary/10 text-foreground" : "bg-muted text-foreground/80"}`}>
      {text}
      <button onClick={onRemove} aria-label={`Sacar "${text}"`} className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-black/5">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function TitleList({ items, empty }: { items: { title: string; sub?: string | null }[]; empty: string }) {
  const [all, setAll] = useState(false);
  if (!items.length) return <p className="text-[13px] text-muted-foreground">{empty}</p>;
  const shown = all ? items : items.slice(0, 5);
  return (
    <div>
      <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
        {shown.map((it, i) => (
          <li key={`${it.title}-${i}`} className="px-3.5 py-2.5">
            <p className="text-[14px] text-foreground">{it.title}</p>
            {it.sub && <p className="text-[12px] text-muted-foreground">{it.sub}</p>}
          </li>
        ))}
      </ul>
      {items.length > 5 && (
        <button onClick={() => setAll((v) => !v)} className="mt-1.5 text-[12.5px] font-semibold text-primary">
          {all ? "Ver menos" : `Ver las ${items.length}`}
        </button>
      )}
    </div>
  );
}

export function ProfileSheet({
  open, onClose, user, onSignIn, onSignOut, onDeleteAccount, onOpenTvRemote, onCountryChange,
}: {
  open: boolean;
  onClose: () => void;
  user: User;
  onSignIn: () => void;
  onSignOut: () => void;
  onDeleteAccount: () => void;
  onOpenTvRemote: () => void;
  onCountryChange?: (code: string) => void;
}) {
  // La memoria vive en localStorage; cada cambio re-lee (y la sincronización sube sola).
  const [, setTick] = useState(0);
  const refresh = () => setTick((n) => n + 1);
  const [draft, setDraft] = useState("");
  const [country, setCountryState] = useState(getCountry);
  useEffect(() => { if (open) { setDraft(""); setCountryState(getCountry()); refresh(); } }, [open]);
  if (!open) return null;

  const t = loadTaste();
  const likes = (t.profile?.likes ?? []).filter((x) => !t.removedTags.includes(x));
  const avoid = (t.profile?.avoid ?? []).filter((x) => !t.removedTags.includes(x));
  const hasMemory = !!t.profile?.summary || t.notes.length > 0;
  const hist = tasteHistory();
  const opened = loadOpened();

  const saveDraft = () => { if (addNote(draft, "manual")) { setDraft(""); refresh(); } };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fade-in fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-background shadow-2xl safe-top safe-bottom" role="dialog" aria-label="Mi cuenta">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <p className="font-serif text-[20px] font-bold text-foreground">Mi cuenta</p>
          <button onClick={onClose} aria-label="Cerrar" className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground active:scale-90">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-10 pt-5">
          {/* Quién sos */}
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-12 w-12 rounded-full object-cover" />
            ) : (
              <div className="h-12 w-12 rounded-full bg-muted" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[16px] font-semibold text-foreground">{user ? (user.name ?? "Tu cuenta") : "Sin cuenta"}</p>
              <p className="truncate text-[12.5px] text-muted-foreground">{user ? user.email : "Entrá para que Miru te recuerde en cualquier dispositivo."}</p>
            </div>
            {user ? (
              <button onClick={onSignOut} className="shrink-0 rounded-full border border-border px-3 py-1.5 text-[12px] font-semibold text-foreground/80 active:scale-95">Cerrar sesión</button>
            ) : (
              <button onClick={onSignIn} className="shrink-0 rounded-full bg-primary px-3.5 py-1.5 text-[12.5px] font-semibold text-primary-foreground active:scale-95">Entrar</button>
            )}
          </div>

          {/* La memoria */}
          <Section
            title="Lo que Miru sabe de vos"
            right={<Toggle on={!t.memoryOff} onClick={() => { setMemoryOff(!t.memoryOff); refresh(); }} label="Usar la memoria" />}
          >
            <div className={t.memoryOff ? "opacity-50" : ""} data-testid="memory">
              {t.memoryOff && (
                <p className="mb-3 rounded-xl bg-muted px-3 py-2 text-[13px] text-foreground/80">
                  Memoria pausada: no la uso para recomendarte. Lo que ya sé queda guardado.
                </p>
              )}
              {t.profile?.summary ? (
                <p className="text-[14.5px] leading-relaxed text-foreground/90">{t.profile.summary}</p>
              ) : (
                <p className="flex items-start gap-2 text-[14px] leading-snug text-muted-foreground">
                  <Brain className="mt-0.5 h-4 w-4 shrink-0" />
                  Todavía te estoy conociendo. Pedime un par de películas, decime qué te gustó, y lo vas a ver acá.
                </p>
              )}

              {(likes.length > 0 || avoid.length > 0) && (
                <div className="mt-3 space-y-2">
                  {likes.length > 0 && (
                    <div>
                      <p className="mb-1 text-[12px] font-semibold text-foreground/70">Te gusta</p>
                      <div className="flex flex-wrap gap-1.5">{likes.map((x) => <Tag key={x} text={x} tone="like" onRemove={() => { removeTag(x); refresh(); }} />)}</div>
                    </div>
                  )}
                  {avoid.length > 0 && (
                    <div>
                      <p className="mb-1 text-[12px] font-semibold text-foreground/70">Evitás</p>
                      <div className="flex flex-wrap gap-1.5">{avoid.map((x) => <Tag key={x} text={x} tone="avoid" onRemove={() => { removeTag(x); refresh(); }} />)}</div>
                    </div>
                  )}
                </div>
              )}

              <p className="mb-1.5 mt-4 text-[12px] font-semibold text-foreground/70">Lo que me pediste recordar</p>
              {t.notes.length > 0 ? (
                <ul className="mb-2 space-y-1.5" data-testid="notes">
                  {t.notes.map((n) => (
                    <li key={n.id} className="flex items-start gap-2 rounded-xl bg-card px-3 py-2 ring-1 ring-border">
                      <span className="flex-1 text-[14px] text-foreground">{n.text}</span>
                      <button onClick={() => { removeNote(n.id); refresh(); }} aria-label={`Olvidar "${n.text}"`} className="mt-0.5 text-muted-foreground"><X className="h-4 w-4" /></button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-2 text-[13px] text-muted-foreground">Nada todavía. Escribilo acá, o decímelo en la charla: "acordate que…".</p>
              )}
              <div className="flex items-center gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveDraft(); }}
                  placeholder="Ej: prefiero verlas subtituladas"
                  maxLength={160}
                  className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-card px-3 text-[14px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <button onClick={saveDraft} disabled={!draft.trim()} aria-label="Agregar a la memoria" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-30">
                  <Plus className="h-5 w-5" />
                </button>
              </div>

              {hasMemory && (
                <button
                  onClick={() => { if (window.confirm("¿Borrar lo que Miru sabe de vos? Se borran tu perfil, lo que le pediste recordar, tus pedidos y opiniones.")) { clearMemory(); refresh(); } }}
                  className="mt-4 flex items-center gap-1.5 text-[12.5px] font-semibold text-red-700"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Borrar la memoria
                </button>
              )}
            </div>
          </Section>

          {/* El historial */}
          <Section title="Te gustaron">
            <TitleList items={hist.liked.map((title) => ({ title }))} empty="Cuando una te cierre (👍) o me digas que te gustó, aparece acá." />
          </Section>
          <Section title="Fuiste a ver">
            <TitleList items={opened.map((o) => ({ title: o.title, sub: o.platform }))} empty="Lo que abras desde Miru queda acá." />
          </Section>
          <Section title="Descartaste">
            <TitleList items={hist.rejected.map((r) => ({ title: r.title, sub: r.reason ? `"${r.reason}"` : null }))} empty="Nada todavía." />
          </Section>

          {/* Ajustes */}
          <Section title="Tu región">
            <select
              value={country}
              onChange={(e) => { setCountry(e.target.value); setCountryState(e.target.value); onCountryChange?.(e.target.value); }}
              className="h-11 w-full rounded-xl border border-border bg-card px-3 text-[14px] text-foreground focus:outline-none"
              aria-label="Tu región"
            >
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
            <p className="mt-1.5 text-[12px] text-muted-foreground">Para buscar lo que está disponible donde estás.</p>
          </Section>

          <Section title="Miru en tu TV">
            <button onClick={onOpenTvRemote} className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-3 text-left active:scale-[0.99]">
              <Tv className="h-5 w-5 text-primary" />
              <span className="flex-1">
                <span className="block text-[14px] font-semibold text-foreground">Conectar la TV</span>
                <span className="block text-[12px] text-muted-foreground">Escaneá el QR y usá el teléfono de control.</span>
              </span>
            </button>
          </Section>

          <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-muted-foreground">
            <a href="/privacidad" target="_blank" rel="noreferrer" className="underline">Privacidad</a>
            <a href="/terminos" target="_blank" rel="noreferrer" className="underline">Términos</a>
            {user && <button onClick={onDeleteAccount} className="ml-auto text-red-700 underline">Borrar mi cuenta</button>}
          </div>
        </div>
      </div>
    </>
  );
}
