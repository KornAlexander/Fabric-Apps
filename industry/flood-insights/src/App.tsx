import { useState } from 'react';

import { RemembranceScreen } from '@/components/RemembranceScreen';
import { TwinShell } from '@/components/TwinShell';

export default function App() {
  // The remembrance screen is not skippable and not on a timer — PLAN §9.0.
  const [entered, setEntered] = useState(false);

  return entered ? <TwinShell /> : <RemembranceScreen onContinue={() => setEntered(true)} />;
}
