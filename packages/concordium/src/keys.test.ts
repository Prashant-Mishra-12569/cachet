import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAccountKey } from './keys';

// A real-format testnet address (public, from the Agent Registry listing). No keys involved.
const ADDRESS = '3dt3UMPzRASZndjmKpSWgCP2HhmoxZrgs8FDPtZjNHZzj13hhB';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cachet-keys-test-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadAccountKey safety checks', () => {
  it('refuses key files inside the project folder', async () => {
    const path = join(dir, 'inside.export');
    await writeFile(path, '{}');
    await expect(
      loadAccountKey({ path, expectedAddress: ADDRESS, network: 'testnet', forbiddenDir: dir }),
    ).rejects.toThrow('outside the project folder');
  });

  it('gives a plain error for a missing file', async () => {
    await expect(
      loadAccountKey({ path: join(dir, 'missing.export'), expectedAddress: ADDRESS, network: 'testnet' }),
    ).rejects.toThrow('Cannot read key file');
  });

  it('rejects a file that is not a wallet export, without echoing its content', async () => {
    const path = join(dir, 'garbage.export');
    await writeFile(path, 'super-secret-not-json');
    const result = loadAccountKey({ path, expectedAddress: ADDRESS, network: 'testnet' });
    await expect(result).rejects.toThrow('Not a valid Concordium wallet export');
    await expect(result).rejects.not.toThrow('super-secret');
  });
});
