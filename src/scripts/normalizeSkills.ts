import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectRoot } from '../lib/loadPrompt';

/**
 * Normalize SKILL.md frontmatter for Mastra: drop plugin-only Anthropic fields
 * (argument-hint, allowed-tools, disable-model-invocation, license) that break
 * Mastra's YAML parser or aren't part of its skill schema. Keeps name /
 * description / version / tags. Idempotent.
 */
const DENY = new Set(['argument-hint', 'allowed-tools', 'disable-model-invocation', 'license']);

const skillsDir = resolve(projectRoot(), 'skills');
let changed = 0;

for (const name of readdirSync(skillsDir)) {
  const p = resolve(skillsDir, name, 'SKILL.md');
  if (!existsSync(p)) continue;
  const raw = readFileSync(p, 'utf8');
  const m = raw.match(/^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)([\s\S]*)$/);
  if (!m) continue;
  const [, open, fm, close, body] = m;

  const kept: string[] = [];
  let dropping = false;
  for (const line of fm.split('\n')) {
    const topKey = line.match(/^([A-Za-z][\w-]*):/);
    if (topKey) {
      dropping = DENY.has(topKey[1]);
      if (!dropping) kept.push(line);
    } else if (!dropping) {
      kept.push(line);
    }
  }

  const newFm = kept.join('\n');
  if (newFm !== fm) {
    writeFileSync(p, open + newFm + close + body);
    changed += 1;
    console.log('normalized:', name);
  }
}
console.log(`done — normalized ${changed} skill(s)`);
