import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractLogs, parseTranscript } from '../lib/vfParseTranscript';

// Mirror of bin/vf-parse-transcript: read transcript JSON, print parsed JSON.
//   npm run test:parse -- <transcript.json> [agentFilter]
const file = process.argv[2];
const agentFilter = process.argv[3] ?? null;
if (!file) {
  console.error('usage: tsx src/scripts/testParse.ts <transcript.json> [agentFilter]');
  process.exit(1);
}
const raw: unknown = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));
const result = parseTranscript(extractLogs(raw), agentFilter);
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
