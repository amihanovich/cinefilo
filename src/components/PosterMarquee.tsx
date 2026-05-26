import { useEffect, useState } from "react";
import { fetchPosters } from "@/lib/posters.functions";
import { getCachedIconic, setCachedIconic } from "@/lib/posterCache";

const ICONIC: { title: string; type: "Película" | "Serie" }[] = [
  { title: "The Godfather", type: "Película" },
  { title: "Pulp Fiction", type: "Película" },
  { title: "Inception", type: "Película" },
  { title: "Interstellar", type: "Película" },
  { title: "Parasite", type: "Película" },
  { title: "Breaking Bad", type: "Serie" },
  { title: "Stranger Things", type: "Serie" },
  { title: "The Crown", type: "Serie" },
  { title: "Succession", type: "Serie" },
  { title: "Dark", type: "Serie" },
  { title: "La La Land", type: "Película" },
  { title: "Whiplash", type: "Película" },
  { title: "The Dark Knight", type: "Película" },
  { title: "Game of Thrones", type: "Serie" },
  { title: "Friends", type: "Serie" },
  { title: "Better Call Saul", type: "Serie" },
  { title: "Oppenheimer", type: "Película" },
  { title: "Dune", type: "Película" },
];

function splitRows(urls: string[]): [string[], string[]] {
  const top: string[] = [];
  const bottom: string[] = [];
  urls.forEach((u, i) => (i % 2 === 0 ? top : bottom).push(u));
  while (top.length && top.length < 6) top.push(...top);
  while (bottom.length && bottom.length < 6) bottom.push(...bottom);
  return [top.slice(0, 12), bottom.slice(0, 12)];
}

export function PosterMarquee({ className = "" }: { className?: string }) {
  const [posters, setPosters] = useState<string[]>(() => getCachedIconic());

  useEffect(() => {
    let alive = true;
    const collected: string[] = [];

    Promise.all([
      fetchPosters({ data: { items: ICONIC.slice(0, 6) } }),
      fetchPosters({ data: { items: ICONIC.slice(6, 12) } }),
      fetchPosters({ data: { items: ICONIC.slice(12, 18) } }),
    ])
      .then((batches) => {
        if (!alive) return;
        for (const b of batches) {
          for (const u of Object.values(b.posters)) {
            if (u) collected.push(u);
          }
        }
        if (collected.length > 0) {
          setPosters(collected);
          setCachedIconic(collected);
        }
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, []);

  if (posters.length === 0) return null;

  const [topRow, bottomRow] = splitRows(posters);
  const topLoop = [...topRow, ...topRow];
  const bottomLoop = [...bottomRow, ...bottomRow];

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-border bg-card/40 ${className}`}
      aria-hidden="true"
    >
      <div className="flex flex-col gap-2 py-2">
        {/* Fila superior — izquierda → derecha */}
        <div className="flex w-max animate-marquee gap-2 px-2">
          {topLoop.map((src, i) => (
            <img
              key={`t-${src}-${i}`}
              src={src}
              alt=""
              loading="lazy"
              className="h-28 w-[74px] shrink-0 rounded-md object-cover shadow-md sm:h-32 sm:w-[86px]"
            />
          ))}
        </div>
        {/* Fila inferior — derecha → izquierda */}
        <div className="flex w-max animate-marquee-reverse gap-2 px-2">
          {bottomLoop.map((src, i) => (
            <img
              key={`b-${src}-${i}`}
              src={src}
              alt=""
              loading="lazy"
              className="h-28 w-[74px] shrink-0 rounded-md object-cover shadow-md sm:h-32 sm:w-[86px]"
            />
          ))}
        </div>
      </div>
      {/* Fades laterales */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-background to-transparent" />
    </div>
  );
}
