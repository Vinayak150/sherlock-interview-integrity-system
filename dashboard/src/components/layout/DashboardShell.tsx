import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Home,
  LayoutDashboard,
  Moon,
  Search,
  Sun,
} from 'lucide-react';

import type { ConnectionState } from '../../hooks/useDecisionStream.js';
import type { LifecycleState } from '../../liveBadgeLogic.js';
import { LiveBadge } from '../../LiveBadge.js';
import { cn } from '../../lib/utils.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';

export type DashboardSection = 'overview' | 'workspace' | 'aggregate';

export function DashboardSidebar({
  collapsed,
  onToggleCollapsed,
  activeSection,
  onSectionChange,
  onGoHome,
}: {
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  readonly activeSection: DashboardSection;
  readonly onSectionChange: (section: DashboardSection) => void;
  readonly onGoHome: () => void;
}): React.JSX.Element {
  const items: readonly { id: DashboardSection; label: string; icon: typeof LayoutDashboard }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'workspace', label: 'Reviewer Workspace', icon: Search },
    { id: 'aggregate', label: 'Aggregate Analytics', icon: BarChart3 },
  ];

  return (
    <aside
      className={cn(
        'sticky top-0 flex h-screen flex-col border-r border-border bg-card transition-all',
        collapsed ? 'w-16' : 'w-64',
      )}
      aria-label="Dashboard navigation"
    >
      <div className="flex items-center justify-between border-b border-border p-4">
        {!collapsed && <span className="text-sm font-semibold">Sherlock</span>}
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>

      <nav className="flex-1 space-y-1 p-2">
        <Button
          variant="ghost"
          className={cn('w-full justify-start', collapsed && 'justify-center px-0')}
          onClick={onGoHome}
        >
          <Home className="h-4 w-4" aria-hidden="true" />
          {!collapsed && <span>Home</span>}
        </Button>
        {items.map((item) => (
          <Button
            key={item.id}
            variant={activeSection === item.id ? 'secondary' : 'ghost'}
            className={cn('w-full justify-start', collapsed && 'justify-center px-0')}
            onClick={() => onSectionChange(item.id)}
            aria-current={activeSection === item.id ? 'page' : undefined}
          >
            <item.icon className="h-4 w-4" aria-hidden="true" />
            {!collapsed && <span>{item.label}</span>}
          </Button>
        ))}
      </nav>
    </aside>
  );
}

export function DashboardTopBar({
  connectionState,
  environment,
  lifecycleState,
  onToggleTheme,
  resolvedTheme,
}: {
  readonly connectionState: ConnectionState;
  readonly environment: string;
  readonly lifecycleState?: LifecycleState;
  readonly onToggleTheme: () => void;
  readonly resolvedTheme: 'light' | 'dark';
}): React.JSX.Element {
  const connectionVariant =
    connectionState === 'connected'
      ? 'success'
      : connectionState === 'connecting'
        ? 'warning'
        : 'muted';

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-sm">
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-6">
        <div>
          <h1 className="text-base font-semibold sm:text-lg">Reviewer Dashboard</h1>
          <p className="text-xs text-muted-foreground">Interview integrity operations</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lifecycleState !== undefined && <LiveBadge lifecycleState={lifecycleState} />}
          <Badge variant={connectionVariant} aria-label={`Connection ${connectionState}`}>
            {connectionState === 'connected'
              ? 'Connected'
              : connectionState === 'connecting'
                ? 'Connecting'
                : 'Disconnected'}
          </Badge>
          <Badge variant="outline">{environment}</Badge>
          <Button variant="ghost" size="icon" onClick={onToggleTheme} aria-label="Toggle theme">
            {resolvedTheme === 'dark' ? (
              <Sun className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Moon className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
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
      <label htmlFor="session-search" className="mb-2 block text-sm font-medium">
        Search by Session ID
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
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
          className="flex h-12 w-full rounded-xl border border-input bg-card py-2 pl-11 pr-4 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border"
        />
      </div>
    </section>
  );
}
