import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.cinefilo.tv",
  appName: "Cinéfilo TV",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
