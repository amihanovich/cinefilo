import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.cinefilo.app",
  appName: "Miru",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
