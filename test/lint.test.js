import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import * as lint from '../src/commands/lint.js';
import { fakeClient, mockFetch, toJSON } from './helpers.js';

const run = (options) => lint.run({ client: fakeClient, options });
const attachment = (name, size = 200) => ({ name, size, url: `https://cdn.discordapp.com/attachments/1/2/${name}` });
const HEADER = 'Game.GUID = "My Game";\nGame.GameName = "My Game";\nGame.ExecutableName = "game.exe";\n';

// Workbench links: base-62 back to bytes (the format of the workbench's Copy link).
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const TAIL = [0, 2, 3, 5, 6, 7];
const decode = (link) => {
  const text = link.split('#share-')[1];
  const out = [];
  for (let i = 0; i < text.length; i += 7) {
    const part = text.slice(i, i + 7);
    let n = 0;
    for (const c of part) n = n * 62 + ALPHABET.indexOf(c);
    const chunk = [];
    for (let k = 0; k < TAIL.indexOf(part.length); k++) {
      chunk.unshift(n % 256);
      n = Math.floor(n / 256);
    }
    out.push(...chunk);
  }
  return inflateRawSync(Buffer.from(out)).toString();
};

test('reports what stops Nucleus, line by line, with a workbench link that opens the handler', async (t) => {
  const source = HEADER + 'Game.KillMutex = "Mutex";\nGame.Play = function () {\n  var a = `-w ${Context.Width}`;\n};\n';
  mockFetch(t, () => new Response(source));
  const embed = toJSON((await run({ file: attachment('MyGame.js') })).embeds[0]);

  assert.match(embed.title, /MyGame\.js/);
  assert.match(embed.description, /Nucleus can't use this handler yet/);
  const problems = embed.fields.find((f) => f.name === 'Problems').value;
  assert.match(problems, /Line 4/); // KillMutex must be a list
  assert.match(problems, /Line 6/); // template string
  const link = embed.description.match(/\((https:\/\/[^)]+)\)/)[1];
  assert.equal(decode(link), source);
  assert.match(embed.fields.find((f) => f.name === 'Try it').value, /can't load/);
});

test('shows each player when the handler is fine', async (t) => {
  mockFetch(t, () => new Response(HEADER + 'Game.Play = function () { Context.StartArguments = "-windowed -w " + Context.Width; };\n'));
  const embed = toJSON((await run({ file: attachment('Good.js') })).embeds[0]);

  assert.match(embed.description, /Ready for Nucleus/);
  const players = embed.fields.find((f) => f.name.startsWith('Try it')).value;
  assert.match(players, /P1\*\* the left half of the screen, 960 × 1080 · `-windowed -w 960`/);
  assert.match(players, /P2/);
});

test('groups settings Nucleus skips for every player', async (t) => {
  mockFetch(t, () => new Response(HEADER + 'Game.Play = function () { for (var i = 0; i < PlayerList.Count; i++) { PlayerList[i].ProtoController5 = 1; } };\n'));
  const embed = toJSON((await run({ file: attachment('P.js') })).embeds[0]);
  assert.equal(embed.fields.find((f) => f.name === 'Settings Nucleus skips').value, '`Player.ProtoController5`');
});

test('a handler cannot reach the bot', async (t) => {
  mockFetch(t, () => new Response(HEADER + 'Game.Play = function () { Context.StartArguments = String(this.constructor.constructor("return typeof process")()); };\n'));
  const embed = toJSON((await run({ file: attachment('Evil.js') })).embeds[0]);
  assert.match(embed.fields.find((f) => f.name.startsWith('Try it')).value, /`undefined`/);
});

test('asks for a .js file', async (t) => {
  const fetch = mockFetch(t, () => new Response(''));
  assert.match((await run({ file: attachment('handler.nc') })).content, /isn't a handler/);
  assert.match((await run({})).content, /Attach a handler/);
  assert.match((await run({ file: attachment('big.js', 5 * 1024 * 1024) })).content, /too big/);
  assert.equal(fetch.mock.calls.length, 0);
});

test('mention form: the attached file', () => {
  const file = attachment('A.js');
  assert.deepEqual(lint.fromMessage({ args: [], attachments: { first: () => file } }), { file });
});
