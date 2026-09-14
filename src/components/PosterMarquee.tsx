import { useEffect, useState } from "react";
import { fetchPosterClient } from "@/lib/itunes";
import { getCachedIconic, setCachedIconic } from "@/lib/posterCache";

const ICONIC: { title: string; type: string }[] = [
  { title: "The Godfather", type: "movie" },
  { title: "Pulp Fiction", type: "movie" },
  { title: "Inception", type: "movie" },
  { title: "Interstellar", type: "movie" },
  { title: "Parasite", type: "movie" },
  { title: "Breaking Bad", type: "serie" },
  { title: "Stranger Things", type: "serie" },
  { title: "The Crown", type: "serie" },
  { title: "Succession", type: "serie" },
  { title: "Dark", type: "serie" },
  { title: "La La Land", type: "movie" },
  { title: "Whiplash", type: "movie" },
  { title: "The Dark Knight", type: "movie" },
  { title: "Game of Thrones", type: "serie" },
  { title: "Oppenheimer", type: "movie" },
  { title: "Better Call Saul", type: "serie" },
  { title: "Dune", type: "movie" },
  { title: "Arrival", type: "movie" },
];

function splitRows(urls: string[]): [string[], string[]] {
  const top: string[] = [];
  const bottom: string[] = [];
  urls.forEach((u, i) => (i % 2 === 0 ? top : bottom).push(u));
  while (top.length && top.length < 6) top.push(...top);
  while (bottom.length && bottom.length < 6) bottom.push(...bottom);
  return [top.slice(0, 12), bottom.slice(0, 12)];
}

type Props = {
  className?: string;
  background?: boolean;
};

export function PosterMarquee({ className = "", background = false }: Props) {
  const [posters, setPosters] = useState<string[]>(() => getCachedIconic());

  useEffect(() => {
    let alive = true;
    const collected: string[] = [...getCachedIconic()];

    // Fire off all fetches in parallel (client-side → direct iTunes calls from browser)
    const promises = ICONIC.map(({ title, type }) =>
      fetchPosterClient(title, type).then((url) => {
        if (alive && url && !collected.includes(url)) {
          collected.push(url);
          setPosters([...collected]);
        }
      }).catch(() => {}),
    );

    Promise.all(promises).then(() => {
      if (alive && collected.length > 0) setCachedIconic(collected);
    });

    return () => { alive = false; };
  }, []);

  const [topRow, bottomRow] = posters.length > 0 ? splitRows(posters) : [[], []];
  const topLoop = [...topRow, ...topRow];
  const bottomLoop = [...bottomRow, ...bottomRow];

  if (background) {
    return (
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {posters.length > 0 && (
          <div
            className="absolute inset-0 flex flex-col justify-center gap-3 opacity-[0.20]"
            style={{ transform: "perspective(700px) rotateX(12deg) scale(1.08)", transformOrigin: "center 45%" }}
          >
            <div className="flex w-max animate-marquee gap-3">
              {topLoop.map((src, i) => (
                <img key={`t-${i}`} src={src} alt="" loading="lazy"
                  className="h-28 w-[74px] shrink-0 rounded-lg object-cover sm:h-32 sm:w-20" />
              ))}
            </div>
            <div className="flex w-max animate-marquee-reverse gap-3">
              {bottomLoop.map((src, i) => (
                <img key={`b-${i}`} src={src} alt="" loading="lazy"
                  className="h-28 w-[74px] shrink-0 rounded-lg object-cover sm:h-32 sm:w-20" />
              ))}
            </div>
          </div>
        )}
        <div className="absolute inset-x-0 top-0 h-2/5 bg-gradient-to-b from-background to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-background to-transparent" />
        <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-background to-transparent" />
        <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-background to-transparent" />
      </div>
    );
  }

  if (posters.length === 0) return null;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-border bg-card/40 ${className}`}
      aria-hidden="true"
    >
      <div className="flex flex-col gap-2 py-2">
        <div className="flex w-max animate-marquee gap-2 px-2">
          {topLoop.map((src, i) => (
            <img key={`t-${src}-${i}`} src={src} alt="" loading="lazy"
              className="h-28 w-[74px] shrink-0 rounded-md object-cover shadow-md sm:h-32 sm:w-[86px]" />
          ))}
        </div>
        <div className="flex w-max animate-marquee-reverse gap-2 px-2">
          {bottomLoop.map((src, i) => (
            <img key={`b-${src}-${i}`} src={src} alt="" loading="lazy"
              className="h-28 w-[74px] shrink-0 rounded-md object-cover shadow-md sm:h-32 sm:w-[86px]" />
          ))}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-background to-transparent" />
    </div>
  );
}
