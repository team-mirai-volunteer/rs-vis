import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const directory = 'public/data';
const names = readdirSync(directory).filter(name => /^(tax-burden-|tax-revenue-).*\.json$/.test(name));
for (const name of names) writeFileSync(join(directory, `${name}.gz`), gzipSync(readFileSync(join(directory, name)), { level: 9 }));
console.log(`Compressed ${names.length} tax-burden/revenue files.`);
