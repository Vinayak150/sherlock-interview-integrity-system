import { useState } from 'react';

import { LandingPage } from './pages/LandingPage.js';
import { ReviewerDashboard } from './pages/ReviewerDashboard.js';

export type AppView = 'landing' | 'dashboard';

export function App(): React.JSX.Element {
  const [view, setView] = useState<AppView>('landing');

  if (view === 'landing') {
    return <LandingPage onLaunchDashboard={() => setView('dashboard')} />;
  }

  return <ReviewerDashboard onGoHome={() => setView('landing')} />;
}
