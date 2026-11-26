/**
 * What we log about a failure: its message only, never the data it was carrying.
 * - A Telegram error object also holds the message we tried to send (a call code, a family name).
 * - A database error's message ends with the query's values ("params: ..."), which can include a
 *   call code or a phone fingerprint. Those are cut off here.
 */
export function errText(err: unknown): string {
  if (!(err instanceof Error)) return typeof err === 'string' ? err : 'unknown error';
  const message = err.message.split(/\nparams:/)[0] ?? '';
  const cause =
    err.cause instanceof Error ? ` (cause: ${err.cause.message.split(/\nparams:/)[0] ?? ''})` : '';
  return `${err.name}: ${message}${cause}`;
}
