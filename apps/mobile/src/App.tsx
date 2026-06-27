import { useEffect, useState } from "react";
import WizardPage from "./wizard";
import VoiceAgent from "./components/VoiceAgent";

const PLATFORMS_KEY = "queveo:guest:default_platforms";
const ONBOARDED_KEY = "cinefilo:onboarded";

export default function App() {
  const [onboarded, setOnboarded] = useState(() => {
    return localStorage.getItem(ONBOARDED_KEY) === "true";
  });

  useEffect(() => {
    if (onboarded) return;
    // If platforms were already saved in a previous session, skip wizard
    const saved = localStorage.getItem(PLATFORMS_KEY);
    if (saved) {
      localStorage.setItem(ONBOARDED_KEY, "true");
      setOnboarded(true);
    }
  }, [onboarded]);

  if (!onboarded) {
    return (
      <WizardPage
        onComplete={() => {
          localStorage.setItem(ONBOARDED_KEY, "true");
          setOnboarded(true);
        }}
      />
    );
  }

  return <VoiceAgent />;
}
