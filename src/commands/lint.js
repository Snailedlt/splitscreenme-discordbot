import { SlashCommandBuilder } from 'discord.js';
import { baseEmbed } from '../embeds.js';
import { checkHandler, shareLink } from '../lintcheck.js';
import Settings from '../settings.js';

const MAX_BYTES = 1024 * 1024;
const MAX_PROBLEMS = 8;
const RED = 0xe74c3c;
const ORANGE = 0xe67e22;
const GREEN = 0x2ecc71;

export const config = {
  name: `lint`,
  aliases: [`check`],
  description: `Checks a handler .js file: problems Nucleus would hit, and what each player gets.`,
  usage: `(attach a handler .js file)`,
  example: ``,
};

export const data = new SlashCommandBuilder()
  .setName(config.name)
  .setDescription(config.description)
  .addAttachmentOption((option) =>
    option.setName('file').setDescription('The handler .js file').setRequired(true),
  );

export const fromMessage = ({ attachments }) => ({ file: attachments?.first?.() });

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// "PlayerList[0].ProtoController5 = 0 (no such member; ...)" for every player -> one line per member.
const skipped = (ignored) => [
  ...new Set(ignored.map((line) => line.replace(/^PlayerList\[\d+\]/, 'Player').replace(/ = .* \(/, ' (').replace(/ \(no such member; Nucleus ignores it\)$/, ''))),
];

export const run = async ({ client, options: { file } }) => {
  if (!file) {
    return { content: 'Attach a handler `.js` file to check, e.g. `/lint file:` and pick the file.' };
  }
  if (!/\.js$/i.test(file.name ?? '')) {
    return { content: `\`${file.name}\` isn't a handler: attach the handler's \`.js\` file.` };
  }
  if (file.size > MAX_BYTES) {
    return { content: `\`${file.name}\` is too big to check here (${Math.round(file.size / 1024)} KB, the limit is 1 MB).` };
  }

  const response = await fetch(file.url);
  if (!response.ok) throw new Error(`attachment download failed: ${response.status}`);
  const source = (await response.text()).replace(/^﻿/, '');
  const { problems, sim } = await checkHandler(source);

  const errors = problems.filter((p) => p.severity === 'error');
  const warnings = problems.filter((p) => p.severity === 'warning');
  const verdict = errors.length
    ? `**Nucleus can't use this handler yet:** ${plural(errors.length, 'error')}${warnings.length ? `, ${plural(warnings.length, 'warning')}` : ''}.`
    : warnings.length
      ? `**Nucleus can use this handler**, but ${plural(warnings.length, 'setting')} may not work as intended.`
      : '**Ready for Nucleus.** No problems found.';

  const workbench = Settings.public.workbenchUrl;
  const link = workbench ? shareLink(workbench, source) : null;
  const linkText = link && link.length <= 3000 ? `\n[Open it in the workbench](${link}) to see and fix the problems.` : workbench ? `\nPaste it into the [workbench](${workbench}) to see and fix the problems.` : '';

  const embed = baseEmbed(client)
    .setColor(errors.length ? RED : warnings.length ? ORANGE : GREEN)
    .setTitle(`Handler check: ${clip(file.name, 200)}`)
    .setDescription(verdict + linkText);

  const shown = [...errors, ...warnings].slice(0, MAX_PROBLEMS);
  if (shown.length) {
    const more = errors.length + warnings.length - shown.length;
    embed.addFields({
      name: `Problems`,
      value: clip(
        shown.map((p) => `${p.severity === 'error' ? '❌' : '⚠️'} **Line ${p.line}**: ${clip(p.message.replace(/\s+/g, ' '), 180)}`).join('\n') +
          (more > 0 ? `\n…and ${more} more.` : ''),
        1024,
      ),
    });
  }

  if (!sim.loaded) {
    embed.addFields({ name: 'Try it', value: clip(`Nucleus can't load it, so nothing would start.\n\`${sim.loadError ?? ''}\``, 1024) });
  } else if (sim.players.length) {
    const ended = sim.sessionEnded;
    const players = sim.players.map((p) => `**P${p.index + 1}** ${p.window}${p.startArguments ? ` · \`${clip(p.startArguments, 120)}\`` : ''}${p.error ? `\n❌ ${clip(p.error, 160)}` : ''}`);
    if (ended && ended.player >= 0) players.push(`Setup fails for player ${ended.player + 1}, so Nucleus ends the session.`);
    embed.addFields({ name: 'Try it (2 players, simulated)', value: clip(players.join('\n'), 1024) });
  }
  const skips = skipped(sim.ignored ?? []);
  if (skips.length) embed.addFields({ name: 'Settings Nucleus skips', value: clip(skips.map((s) => `\`${s}\``).join(', '), 1024) });

  return { embeds: [embed] };
};
