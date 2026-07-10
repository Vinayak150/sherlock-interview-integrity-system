import { Search, Shield } from 'lucide-react';

import { LiveBadge } from '../../LiveBadge.js';
import type { ConnectionState } from '../../hooks/useDecisionStream.js';
import type { LifecycleState } from '../../liveBadgeLogic.js';
import { Badge } from '../ui/badge.js';

export function TopNav({
  connectionState,
  environment,
  lifecycleState,
}: {
  readonly connectionState: ConnectionState;
  readonly environment: string;
  readonly lifecycleState?: LifecycleState;
}): React.JSX.Element {
  const connectionVariant =
    connectionState === 'connected'
      ? 'success'
      : connectionState === 'connecting'
        ? 'warning'
        : 'muted';

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50"
            aria-hidden="true"
          >
            <Shield className="h-5 w-5 text-zinc-700" />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-900">Sherlock</p>
            <p className="text-xs text-zinc-500">Interview Integrity</p>
          </div>
        </div>

        <div className="text-center">
          <h1 className="text-sm font-medium text-zinc-900 sm:text-base">
            Sherlock Interview Integrity Dashboard
          </h1>
          <p className="text-xs text-zinc-500">Reviewer operations console</p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {lifecycleState !== undefined && <LiveBadge lifecycleState={lifecycleState} />}
          <Badge variant={connectionVariant} aria-label={`Connection ${connectionState}`}>
            {connectionState === 'connected'
              ? 'Connected'
              : connectionState === 'connecting'
                ? 'Connecting'
                : 'Disconnected'}
          </Badge>
          <Badge variant="outline" aria-label={`Environment ${environment}`}>
            {environment}
          </Badge>
        </div>
      </div>
    </header>
  );
}

export function SearchBar({
  value,
  onChange,
  onSubmit,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
}): React.JSX.Element {
  return (
    <section aria-label="Session search" className="mx-auto max-w-3xl">
      <label htmlFor="session-search" className="mb-2 block text-sm font-medium text-zinc-700">
        Search by Session ID
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
          aria-hidden="true"
        />
        <input
          id="session-search"
          type="search"
          value={value}
          placeholder="Enter Session ID..."
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSubmit();
          }}
          className="flex h-12 w-full rounded-xl border border-zinc-200 bg-white py-2 pl-11 pr-4 text-sm shadow-sm transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
        />
      </div>
    </section>
  );
}
