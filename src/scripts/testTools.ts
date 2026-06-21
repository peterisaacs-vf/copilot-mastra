import { loadPromptingGuide } from '../tools/promptingGuide';
import { diffPrompts } from '../tools/diffPrompts';

// vf-load-prompting-guide port
for (const m of ['claude-4.5-haiku', 'voiceflow-core-4.0', 'gpt-5.2', 'mistral-x']) {
  const g = loadPromptingGuide(m);
  console.log(
    `guide[${m}]: file=${g.path.split('/').pop() || '(none)'} len=${g.content.length} stale=${g.stale} covered=${g.modelCovered}`,
  );
}

// vf-diff-prompts port (note: rules content == guardrails content -> duplicate flag)
const orig = `<role>You are a helpful bot.</role>
<tone>Friendly and warm.</tone>
<rules>Be nice. Never share secrets.</rules>`;
const opt = `<role>You are a helpful assistant.</role>
<tone>Friendly and warm.</tone>
<guardrails>Be nice. Never share secrets.</guardrails>`;

const d = diffPrompts(orig, opt);
console.log('\ndiff summary:', d.summary);
for (const c of d.changes) {
  console.log(
    `  ${c.section} [${c.type}]` +
      (c.similarity !== undefined ? ` sim=${c.similarity}` : '') +
      (c.reason ? ` reason="${c.reason}"` : ''),
  );
}
console.log('unchanged:', d.unchanged, '| stats:', JSON.stringify(d.stats));
