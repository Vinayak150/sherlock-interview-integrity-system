import { AlertCircle, RefreshCw } from 'lucide-react';
import * as React from 'react';

import { cn } from '../../lib/utils.js';
import { Button } from './button.js';

export function Alert({
  className,
  variant = 'default',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  readonly variant?: 'default' | 'destructive';
}): React.JSX.Element {
  return (
    <div
      role="alert"
      className={cn(
        'relative flex gap-3 rounded-lg border p-4 text-sm',
        variant === 'destructive'
          ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200'
          : 'border-border bg-card text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function ErrorAlert({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry?: () => void;
}): React.JSX.Element {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium">Something went wrong</p>
          <p className="mt-1 opacity-90">{message}</p>
        </div>
        {onRetry !== undefined && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Retry
          </Button>
        )}
      </div>
    </Alert>
  );
}
