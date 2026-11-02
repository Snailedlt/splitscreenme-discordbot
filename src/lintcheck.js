import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { deflateRawSync } from 'node:zlib';

// The `nucleus` CLI from splitscreenme-vscode (the build its agent skill ships: one self-contained
// file). Update it with `npm run update:nucleus`. Its `simulate` runs the handler in an isolated
// vm context with a time limit, so a handler can't reach the bot's process or files.
const CLI = fileURLToPath(new URL('./vendor/nucleus.cjs', import.meta.url));
const run = promisify(execFile);
const TIMEOUT_MS = 15_000;

const cli = async (args) => {
  try {
    const { stdout } = await run(process.execPath, [CLI, ...args], { timeout: TIMEOUT_MS, maxBuffer: 16 << 20 });
    return JSON.parse(stdout);
  } catch (error) {
    // Exit code 1 means "found problems"; the JSON is still on stdout.
    if (error.stdout) return JSON.parse(error.stdout);
    throw error;
  }
};

/** Lints the handler and simulates it for 2 players (player 1 on keyboard and mouse). */
export const checkHandler = async (source) => {
  const dir = await mkdtemp(join(tmpdir(), 'nucleus-lint-'));
  try {
    const file = join(dir, 'handler.js');
    await writeFile(file, source);
    const lint = await cli(['lint', '--json', file]);
    const sim = await cli(['simulate', file, '--json', '--players', '2', '--keyboard', '1']);
    const lines = source.split('\n');
    const lineOf = (offset) => source.slice(0, offset).split('\n').length;
    const problems = (lint.files[0]?.diagnostics ?? []).map((d) => ({ ...d, line: d.line ?? lineOf(d.start), text: lines[(d.line ?? lineOf(d.start)) - 1]?.trim() }));
    return { problems, sim };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

// Workbench share links, the same format as the workbench's own Copy link (playground/src/share.ts
// in nucleuscoop-handler-testbench): deflate-raw, then 5 bytes -> 7 base-62 characters.
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const TAIL_CHARS = [0, 2, 3, 5, 6, 7];
const toBase62 = (bytes) => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 5) {
    const chunk = bytes.subarray(i, i + 5);
    let n = 0;
    for (const b of chunk) n = n * 256 + b;
    let s = '';
    for (let k = 0; k < TAIL_CHARS[chunk.length]; k++) {
      s = ALPHABET[n % 62] + s;
      n = Math.floor(n / 62);
    }
    out += s;
  }
  return out;
};

/** A workbench link that opens this handler. */
export const shareLink = (workbenchUrl, source) => `${workbenchUrl}#share-${toBase62(deflateRawSync(Buffer.from(source)))}`;
