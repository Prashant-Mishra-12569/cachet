'use client';

import { useEffect, useState } from 'react';

/**
 * Shows a time in the reader's own timezone. The server renders UTC first (no layout jump,
 * works without JavaScript), then the browser swaps in local time.
 */
export function LocalTime({ iso, withDate = true }: { iso: string; withDate?: boolean }) {
  const utc = new Date(iso).toLocaleString('en-GB', {
    timeZone: 'UTC',
    ...(withDate ? { day: 'numeric', month: 'short' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  });
  const [text, setText] = useState(`${utc} UTC`);
  useEffect(() => {
    setText(
      new Date(iso).toLocaleString(undefined, {
        ...(withDate ? { day: 'numeric', month: 'short' } : {}),
        hour: '2-digit',
        minute: '2-digit',
      }),
    );
  }, [iso, withDate]);
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}
