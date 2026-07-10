import {
  Activity,
  ArrowRight,
  Brain,
  ExternalLink,
  GitBranch,
  Layers,
  Lock,
  Moon,
  Scale,
  Shield,
  Sun,
  Users,
} from 'lucide-react';

import { useTheme } from '../hooks/useTheme.js';
import { Button } from '../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card.js';

const GITHUB_URL =
  (import.meta.env.VITE_GITHUB_URL as string | undefined) ??
  'https://github.com/Vinayak150/sherlock-interview-integrity-system';

const ARCHITECTURE_URL =
  'https://github.com/Vinayak150/sherlock-interview-integrity-system/blob/main/docs/architecture.md';

const FEATURES = [
  {
    icon: Layers,
    title: 'Evidence Fusion',
    description:
      'Bayesian log-odds fusion across seven bundle families with Beta-distributed posteriors and per-event clamping.',
  },
  {
    icon: GitBranch,
    title: 'Lifecycle FSM',
    description:
      'Eight-state session lifecycle with hysteresis, dwell-time, and distinct lost-confidence vs disqualified paths.',
  },
  {
    icon: Scale,
    title: 'Decision Engine',
    description:
      'Abstention, tie-breaking, low-noise alerts, and reviewer recommendations without coupling to explanation.',
  },
  {
    icon: Brain,
    title: 'Explainable AI',
    description:
      'Deterministic Evidence Reports with ranked signals; optional LLM narrative that cannot affect score or state.',
  },
  {
    icon: Users,
    title: 'Human Review',
    description:
      'Reviewer override, appeals, accommodation disclosure, and SSE live updates for human-in-the-loop adjudication.',
  },
  {
    icon: Lock,
    title: 'Privacy & Security',
    description:
      'Field encryption for biometric evidence, audit logging on sensitive views, and consented client capture.',
  },
] as const;

const PIPELINE = [
  'Client Agent',
  'API Layer',
  'Evidence Bundles',
  'Fusion Engine',
  'Lifecycle FSM',
  'Decision Engine',
  'Explanation Engine',
  'Reviewer Dashboard',
] as const;

const TECH_STACK = [
  'React',
  'TypeScript',
  'Node.js',
  'PostgreSQL',
  'Redis',
  'FastAPI',
  'Railway',
  'Docker',
  'Tailwind',
  'Recharts',
] as const;

export function LandingPage({
  onLaunchDashboard,
}: {
  readonly onLaunchDashboard: () => void;
}): React.JSX.Element {
  const { resolved, toggle } = useTheme();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card">
              <Shield className="h-5 w-5" aria-hidden="true" />
            </div>
            <span className="font-semibold">Sherlock</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
              {resolved === 'dark' ? (
                <Sun className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
            <Button onClick={onLaunchDashboard}>Launch Dashboard</Button>
          </div>
        </div>
      </header>

      <section className="grid-background relative overflow-hidden border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-20 lg:px-8 lg:py-28">
          <div className="max-w-3xl">
            <p className="mb-4 text-sm font-medium uppercase tracking-widest text-muted-foreground">
              Enterprise AI Platform
            </p>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
              Sherlock
              <span className="mt-2 block text-muted-foreground">Interview Integrity System</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              Real-time AI-powered interview integrity analysis using Bayesian evidence fusion,
              lifecycle state machines, explainable decision making, and human-in-the-loop review.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" onClick={onLaunchDashboard}>
                Launch Dashboard
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href={ARCHITECTURE_URL} target="_blank" rel="noreferrer">
                  View Architecture
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </a>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                  View GitHub
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 lg:px-8">
        <div className="mb-10">
          <h2 className="text-2xl font-semibold">Platform capabilities</h2>
          <p className="mt-2 text-muted-foreground">
            Built for production-grade interview integrity workflows.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <Card key={feature.title} className="transition-shadow hover:shadow-md">
              <CardHeader>
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted">
                  <feature.icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <CardTitle>{feature.title}</CardTitle>
                <CardDescription>{feature.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-muted/40 py-16">
        <div className="mx-auto max-w-6xl px-4 lg:px-8">
          <div className="mb-10">
            <h2 className="text-2xl font-semibold">Architecture pipeline</h2>
            <p className="mt-2 text-muted-foreground">
              End-to-end flow from client signals to reviewer decisions.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-3 md:max-w-xl">
            {PIPELINE.map((step, index) => (
              <div key={step} className="flex flex-col items-center gap-3">
                <Card className="w-full">
                  <CardContent className="flex items-center gap-3 p-4">
                    <Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <span className="font-medium">{step}</span>
                  </CardContent>
                </Card>
                {index < PIPELINE.length - 1 && (
                  <span className="text-muted-foreground" aria-hidden="true">
                    ↓
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 lg:px-8">
        <div className="mb-8">
          <h2 className="text-2xl font-semibold">Technology</h2>
          <p className="mt-2 text-muted-foreground">
            Modern stack for orchestration, inference, and review.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {TECH_STACK.map((tech) => (
            <span
              key={tech}
              className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium"
            >
              {tech}
            </span>
          ))}
        </div>
      </section>

      <footer className="border-t border-border py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground sm:flex-row lg:px-8">
          <p>Sherlock Interview Integrity System · Pilot M0–M16</p>
          <Button variant="outline" onClick={onLaunchDashboard}>
            Open reviewer dashboard
          </Button>
        </div>
      </footer>
    </div>
  );
}
