import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.cinefilo.app",
  appName: "Cinéfilo",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
