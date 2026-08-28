import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function downloadData() {
  const files = ['a_stocks.json', 'hk_stocks.json', 'etf_stocks.json'];
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const destDataDir = path.join(os.homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'dsh-plugin-stock-x', 'data');
  if (!fs.existsSync(destDataDir)) fs.mkdirSync(destDataDir, { recursive: true });

  for (const f of files) {
    const url = 'https://raw.githubusercontent.com/Awu12277/dsh-stock-watch/main/data/' + f;
    const res = await fetch(url);
    const content = await res.text();
    fs.writeFileSync(path.join(dataDir, f), content, 'utf8');
    fs.writeFileSync(path.join(destDataDir, f), content, 'utf8');
    console.log('Saved data file:', f, 'size:', content.length);
  }
}

downloadData().catch(e => console.error(e));
