import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = 'https://raw.githubusercontent.com/Awu12277/dsh-stock-watch/main/index.js';
  const res = await fetch(url);
  let code = await res.text();

  // Replace dsh-stock-watch with dsh-stock-plugin
  code = code.replaceAll('dsh-stock-watch', 'dsh-stock-plugin');

  fs.writeFileSync(path.join(__dirname, 'index.js'), code, 'utf8');

  const destDir = path.join(os.homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'dsh-stock-plugin');
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(path.join(destDir, 'index.js'), code, 'utf8');

  console.log('index.js successfully written! Size:', code.length);
}

main().catch(err => console.error(err));
