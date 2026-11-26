import { describe, expect, it } from 'vitest';
import { errText } from './err-text';

describe('errText (what we log about a failure)', () => {
  it('drops the query values a database error carries', () => {
    const err = new Error('Failed query: insert into "seals" values ($1, $2)\nparams: 01ABC,4721');
    expect(errText(err)).toBe('Error: Failed query: insert into "seals" values ($1, $2)');
    expect(errText(new Error('outer', { cause: err }))).not.toContain('4721');
  });

  it('never prints the payload a Telegram error holds', () => {
    const err = Object.assign(new Error("Call to 'sendMessage' failed! (400: chat not found)"), {
      payload: { text: 'Your code: 47-21' },
    });
    expect(errText(err)).not.toContain('47-21');
  });
});
