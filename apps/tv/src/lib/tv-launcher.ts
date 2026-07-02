// Lanzamiento de apps de streaming en Android TV.
//
// OJO: los packages de las apps de TV son DISTINTOS a los de celular
// (Netflix TV = com.netflix.ninja, no com.netflix.mediaclient). Y en TV NUNCA
// caemos a un navegador web (muchas TVs no tienen).
//
// Estrategia:
//   1. Deeplink nativo de JustWatch (scheme custom → abre el título exacto).
//   2. Lanzar la app por package.
//   3. Si nada abre → devolvemos "manual" para que la UI muestre
//      "Abrí {plataforma} y buscá «{título}»".
//
// RIESGO CONOCIDO (a validar en dispositivo): @capacitor/app-launcher usa
// getLaunchIntentForPackage, que devuelve null para apps solo-leanback → puede
// no abrir por package. Si el emulador/dispositivo lo confirma, se agrega un
// plugin nativo mínimo (TvLauncherPlugin con getLeanbackLaunchIntentForPackage).

import { AppLauncher } from "@capacitor/app-launcher";
import { jwSearch } from "./justwatch";
import { getCountry } from "./tv-utils";

// Nombre de plataforma → package de la app en Android TV.
// Confianza: alta salvo donde se indica. Todos: validar en dispositivo real.
const TV_PACKAGES: Record<string, string> = {
  Netflix: "com.netflix.ninja",
  "Prime Video": "com.amazon.amazonvideo.livingroom",
  "Disney+": "com.disney.disneyplus",
  "Star+": "com.disney.disneyplus", // fusionado con Disney+ en LatAm
  Max: "com.wbd.stream",
  "Apple TV+": "com.apple.atve.androidtv.appletv",
  "Paramount+": "com.cbs.ott", // media confianza — verificar
};

export type LaunchResult = "app" | "manual";

async function tryOpen(url: string): Promise<boolean> {
  try {
    // No confiamos en canOpenUrl como bloqueo: para packages sin entrada en
    // <queries> puede dar falso-negativo. Intentamos abrir directamente y
    // dejamos que el catch decida.
    await AppLauncher.openUrl({ url });
    return true;
  } catch {
    return false;
  }
}

export async function launchOnTv(
  title: string,
  platform: string,
  type: string,
): Promise<LaunchResult> {
  // 1) Deeplink nativo exacto de JustWatch (si es scheme custom, no http).
  try {
    const jw = await jwSearch(title, platform, type, getCountry());
    if (jw.deeplinkAndroid && !/^https?:/i.test(jw.deeplinkAndroid)) {
      if (await tryOpen(jw.deeplinkAndroid)) return "app";
    }
  } catch {
    /* seguimos al fallback por package */
  }

  // 2) Lanzar la app por package.
  const pkg = TV_PACKAGES[platform];
  if (pkg && (await tryOpen(pkg))) return "app";

  // 3) Nada abrió → instrucción manual en pantalla.
  return "manual";
}
