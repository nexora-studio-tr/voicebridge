import { readFileSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
// Rebuild fixtures only from an actual local-engine benchmark, never from handwritten translations.
const root = path.resolve(import.meta.dirname, '..'),
  source = path.join(root, 'artifacts/local-validation'),
  target = path.join(root, 'examples/demo');
const report = JSON.parse(readFileSync(path.join(source, 'report.json'), 'utf8'));
if (report.status !== 'completed' || report.synthetic !== true || report.samples.length !== 4)
  throw new Error('A completed synthetic benchmark is required');
mkdirSync(target, { recursive: true });
const samples = report.samples.map((row, i) => {
  if (row.id !== i) throw new Error('Unexpected sample order');
  for (const prefix of ['source', 'translated'])
    copyFileSync(path.join(source, `${prefix}-${i}.wav`), path.join(target, `${prefix}-${i}.wav`));
  return {
    sourceLanguage: row.sourceLanguage,
    language: row.language,
    reference: row.reference,
    source: row.source,
    text: row.text,
    sourceAudio: `source-${i}.wav`,
    audio: `translated-${i}.wav`,
    pipelineMs: row.pipelineMs,
  };
});
writeFileSync(path.join(target, 'samples.json'), JSON.stringify(samples, null, 2) + '\n');
console.log('Prepared 4 recorded local-engine samples. See docs/VALIDATION.md for quality limits.');
