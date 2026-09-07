#!/usr/bin/env node
// Deploy-time injection: build the exact jsCode for the n8n "Load Engine" node
// from the current discovery/bundle.lean.js, then print the update_workflow
// operation JSON so it can be applied via the n8n MCP.
//
//   node scripts/inject-bundle.mjs            # prints the operation JSON
//   node scripts/inject-bundle.mjs --file out.json   # write op to a file
//
// The Load Engine Code node returns [{ json: { bundle } }] where bundle is the
// bundle source as a JS string. Other nodes read it via
//   new Function(bundle + '; return PUREGH;')()
// This is the single copy of the engine (AGENTS.md §17).

import fs from 'node:fs';
import path from 'node:path';

const DIR = import.meta.dirname;
const ROOT = path.resolve(DIR, '..');
const LEAN = path.join(ROOT, 'discovery', 'bundle.lean.js');

const raw = fs.readFileSync(LEAN, 'utf8');
const jsCode = `const __bundle = ${JSON.stringify(raw)};\nreturn [{ json: { bundle: __bundle } }];`;

const op = {
  type: 'updateNodeParameters',
  nodeName: 'Load Engine',
  parameters: { mode: 'runOnceForAllItems', jsCode },
};

const json = JSON.stringify(op);
const arg = process.argv.find((a) => a.startsWith('--file='));
if (arg) {
  fs.writeFileSync(arg.slice('--file='.length), json, 'utf8');
  console.error(`wrote operation JSON (${Buffer.byteLength(json)} bytes)`);
} else {
  process.stdout.write(json);
}
console.error(`# jsCode bytes: ${Buffer.byteLength(jsCode)}`);