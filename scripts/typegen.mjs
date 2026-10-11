import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'types'], { stdio: 'inherit' });
const path = 'worker-configuration.d.ts';
await writeFile(path, (await readFile(path, 'utf8')).replace(/[\t ]+$/gm, ''));
