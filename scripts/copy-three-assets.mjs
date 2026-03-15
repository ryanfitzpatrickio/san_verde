import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const publicRoot = path.join(root, 'public', 'vendor');

const copies = [
  {
    from: path.join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco'),
    to: path.join(publicRoot, 'draco')
  },
  {
    from: path.join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'basis'),
    to: path.join(publicRoot, 'basis')
  }
];

mkdirSync(publicRoot, { recursive: true });

for (const entry of copies) {
  if (!existsSync(entry.from)) {
    continue;
  }

  rmSync(entry.to, { recursive: true, force: true });
  cpSync(entry.from, entry.to, { recursive: true });
}
