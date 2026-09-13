import GigaChat from 'gigachat';
import { Agent } from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve('..', '.env');
const envFile = fs.readFileSync(envPath, 'utf8');

function envValue(name, lines) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(new RegExp(`^${name}\\s*:\\s*(.*)$`, 'i'));
    if (!m) continue;
    const inline = m[1].trim();
    if (inline) return inline;
    for (let j = i + 1; j < lines.length; j++) {
      const s = lines[j].trim();
      if (!s) continue;
      return /^[A-Za-z ]+:/.test(s) ? undefined : s;
    }
  }
  return undefined;
}

const lines = envFile.split(/\r?\n/);
const clientId = envValue('Client ID', lines);
const clientSecret = envValue('Client Secret', lines);
let credentials = envValue('Authorization Key', lines);
const scope = envValue('Scope', lines) ?? 'GIGACHAT_API_PERS';

if (!credentials) {
  if (!clientId || !clientSecret) {
    console.error('В ' + envPath + ' нет Authorization Key (или Client ID с Client Secret).');
    process.exit(1);
  }
  credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

const imagePath = path.resolve(process.argv[2] ?? 'passport.jpg');
if (!fs.existsSync(imagePath)) {
  console.error('Файл изображения не найден: ' + imagePath);
  process.exit(1);
}

const dir = import.meta.dirname;
const promptFile = fs
  .readdirSync(dir)
  .filter((f) => /^prompt_.+\.txt$/i.test(f))
  .sort((a, b) => a.localeCompare(b, 'ru'))[0] ?? 'prompt.txt';
const promptText = fs.readFileSync(path.join(dir, promptFile), 'utf8').trim();

const client = new GigaChat({
  timeout: 600,
  model: process.env.GIGACHAT_MODEL ?? 'GigaChat-2-Pro',
  credentials,
  scope,
  httpsAgent: new Agent({ rejectUnauthorized: false }),
});

const file = new File([fs.readFileSync(imagePath)], path.basename(imagePath), {
  type: path.extname(imagePath) === '.png' ? 'image/png' : 'image/jpeg',
});
const uploadedFile = await client.uploadFile(file);

const response = await client.chat({
  messages: [
    {
      role: 'user',
      content: promptText,
      attachments: [uploadedFile.id],
    },
  ],
  temperature: 0.1,
});

const text = response.choices[0]?.message.content ?? '';
const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
console.log(JSON.stringify(JSON.parse(json), null, 2));