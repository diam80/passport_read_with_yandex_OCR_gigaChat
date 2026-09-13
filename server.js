import express from 'express';
import GigaChat from 'gigachat';
import { Agent } from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_PROMPT = `Ты распознаёшь паспорт гражданина РФ на фото.
Верни СТРОГО один JSON без пояснений и без markdown со следующими полями:
{
  "fullName": "Фамилия Имя Отчество полностью",
  "series": "серия паспорта (4 цифры)",
  "number": "номер паспорта (6 цифр)",
  "birthDate": "дата рождения в формате ДД.ММ.ГГГГ",
  "birthPlace": "место рождения как написано в паспорте",
  "issueDate": "дата выдачи ДД.ММ.ГГГГ",
  "issueCode": "код подразделения (формат XXX-XXX)",
  "issueAuthority": "кем выдан (наименование органа, выдавшего паспорт)",
  "gender": "пол: МУЖ или ЖЕН",
  "address": "адрес регистрации как написано в паспорте"
}`;

function promptPath(name) {
  return path.join(__dirname, `prompt_${name}.txt`);
}

function listPrompts() {
  return fs
    .readdirSync(__dirname)
    .filter((f) => /^prompt_.+\.txt$/i.test(f))
    .map((f) => f.replace(/^prompt_/i, '').replace(/\.txt$/i, ''))
    .sort((a, b) => a.localeCompare(b, 'ru'));
}

function sanitizePromptName(name) {
  let s = String(name ?? '')
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s || s === '.' || s === '..') s = 'Промпт';
  s = s.replace(/[. ]+$/g, '');
  return s || 'Промпт';
}

function readPrompt(name) {
  return fs.readFileSync(promptPath(name), 'utf8').trim();
}

function writePrompt(name, text) {
  fs.writeFileSync(promptPath(name), String(text).trim() + '\n', 'utf8');
}

function ensurePrompts() {
  if (listPrompts().length === 0) {
    let content = '';
    try {
      content = fs.readFileSync(path.join(__dirname, 'prompt.txt'), 'utf8').trim();
    } catch { /* нет старого файла */ }
    writePrompt('Стандартный', content || DEFAULT_PROMPT);
  }
}

let currentPrompt = null;
ensurePrompts();
currentPrompt = listPrompts()[0] ?? null;

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

function loadCredentials() {
  const envPath = path.resolve('..', '.env');
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  const clientId = envValue('Client ID', lines);
  const clientSecret = envValue('Client Secret', lines);
  let credentials = envValue('Authorization Key', lines);
  const scope = envValue('Scope', lines) ?? 'GIGACHAT_API_PERS';
  if (!credentials) {
    if (!clientId || !clientSecret) {
      throw new Error(`В ${envPath} нет Authorization Key (или Client ID с Client Secret).`);
    }
    credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  }
  return { credentials, scope };
}

const DEFAULT_MODEL = process.env.GIGACHAT_MODEL ?? 'GigaChat-2-Pro';

const DEFAULT_MODELS = [
  'GigaChat-2-Pro',
  'GigaChat-2-Max',
  'GigaChat-2-Mini',
  'GigaChat-2-Lite',
  'GigaChat-2-Emotions',
  'GigaChat-2-Top',
  'GigaChat-2-Vision',
  'GigaChat-Max',
  'GigaChat-Max-preview',
  'GigaChat-Plus',
  'GigaChat-Pro',
  'GigaChat-Pro-preview',
  'GigaChat-preview',
  'Embeddings',
];

function modelsPath() {
  return path.join(__dirname, 'models.txt');
}

function readModels() {
  try {
    const lines = fs
      .readFileSync(modelsPath(), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length) return [...new Set(lines)].sort((a, b) => a.localeCompare(b, 'en'));
  } catch { /* файла нет */ }
  return [...DEFAULT_MODELS].sort((a, b) => a.localeCompare(b, 'en'));
}

function addModel(name) {
  const value = String(name ?? '').trim();
  if (!value) return { models: readModels(), added: false };
  const models = readModels();
  if (models.includes(value)) return { models, added: false };
  models.push(value);
  const sorted = [...new Set(models)].sort((a, b) => a.localeCompare(b, 'en'));
  fs.writeFileSync(modelsPath(), sorted.join('\n') + '\n', 'utf8');
  return { models: sorted, added: true };
}

function createClient(model) {
  const { credentials, scope } = loadCredentials();
  return new GigaChat({
    timeout: 600,
    model: model || DEFAULT_MODEL,
    credentials,
    scope,
    httpsAgent: new Agent({ rejectUnauthorized: false }),
  });
}

async function recognize(imageBuffer, mime, model) {
  const client = createClient(model);
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const file = new File([imageBuffer], `passport.${ext}`, { type: mime });
  const uploadedFile = await client.uploadFile(file);
  const promptName = currentPrompt ?? listPrompts()[0];
  const response = await client.chat({
    messages: [{ role: 'user', content: readPrompt(promptName), attachments: [uploadedFile.id] }],
    temperature: 0.1,
  });
  const text = response.choices[0]?.message.content ?? '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('Модель не вернула JSON: ' + text.slice(0, 300));
  }
  return JSON.parse(text.slice(start, end + 1));
}

const YANDEX_OCR_URL = 'https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText';

const YANDEX_MIME = {
  'image/jpeg': 'JPEG',
  'image/jpg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
  'image/heic': 'HEIC',
  'application/pdf': 'PDF',
};

function yandexCredentials() {
  const envPath = path.resolve('..', '.env');
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  return {
    apiKey: envValue('YANDEX_API_KEY', lines),
    folderId: envValue('YANDEX_FOLDER_ID', lines),
  };
}

function yandexConfigured() {
  const { apiKey, folderId } = yandexCredentials();
  return Boolean(apiKey && folderId);
}

async function recognizeYandex(imageBuffer, mime, model) {
  const { apiKey, folderId } = yandexCredentials();
  if (!apiKey || !folderId) {
    throw new Error('В .env не заполнены YANDEX_API_KEY / YANDEX_FOLDER_ID.');
  }
  const mimeType = YANDEX_MIME[mime];
  if (!mimeType) {
    throw new Error(`Формат ${mime || 'неизвестен'} не поддерживается Yandex OCR (JPEG/PNG/PDF/WEBP/HEIC).`);
  }
  const modelName = String(model ?? '').trim() || 'passport';
  const res = await fetch(YANDEX_OCR_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Api-Key ' + apiKey,
      'x-folder-id': folderId,
      'x-data-logging-enabled': 'false',
    },
    body: JSON.stringify({
      mimeType,
      languageCodes: ['*'],
      model: modelName,
      content: imageBuffer.toString('base64'),
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Yandex OCR ${res.status}: ${t.slice(0, 400)}`);
  }
  const data = await res.json();
  const annotation = data?.result?.textAnnotation;
  if (!annotation) throw new Error('Yandex OCR: пустой ответ (нет textAnnotation)');

  const lines = (annotation.entities ?? []).map((e) => {
    const name = String(e.name ?? '').trim();
    const text = String(e.text ?? '').trim();
    return (name || text) ? `${name || '?'}: ${text}` : null;
  }).filter(Boolean);

  const fullText = String(annotation.fullText ?? '').trim();
  if (fullText) lines.push('', '— Полный текст —', fullText);

  const blockText = String(
    (annotation.blocks ?? [])
      .flatMap((b) => (b.lines ?? []).map((l) => l.text))
      .filter((t) => t)
      .join('\n'),
  ).trim();
  if (!lines.length && blockText) lines.push(blockText);

  return {
    engine: 'yandex',
    model: modelName,
    text: lines.length ? lines.join('\n') : '(текст не найден)',
    raw: JSON.stringify(data, null, 2),
  };
}

function openWithDefaultApp(target) {
  return new Promise((resolve, reject) => {
    let cmd;
    if (process.platform === 'win32') cmd = `start "" "${target}"`;
    else if (process.platform === 'darwin') cmd = `open "${target}"`;
    else cmd = `xdg-open "${target}"`;
    exec(cmd, { shell: true }, (err) => (err ? reject(err) : resolve()));
  });
}

function credentialsConfigured() {
  try {
    loadCredentials();
    return true;
  } catch {
    return false;
  }
}

const app = express();
app.use(express.json({ limit: '25mb' }));

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.post('/api/recognize', async (req, res) => {
  try {
    const image = req.body?.image;
    const m = /^data:image\/(png|jpeg|jpg|webp|bmp);base64,(.+)$/s.exec(image ?? '');
    if (!m) return res.status(400).json({ error: 'Некорректные данные изображения' });
    const mime = 'image/' + (m[1] === 'jpg' ? 'jpeg' : m[1]);
    const fields = await recognize(Buffer.from(m[2], 'base64'), mime, req.body?.model);
    res.json(fields);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.post('/api/recognize-yandex', async (req, res) => {
  try {
    const image = req.body?.image;
    const m = /^data:image\/(png|jpeg|jpg|webp|bmp);base64,(.+)$/s.exec(image ?? '');
    if (!m) return res.status(400).json({ error: 'Некорректные данные изображения' });
    const mime = 'image/' + (m[1] === 'jpg' ? 'jpeg' : m[1]);
    const fields = await recognizeYandex(Buffer.from(m[2], 'base64'), mime, req.body?.model);
    res.json(fields);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.get('/api/models', (_req, res) => res.json({ models: readModels() }));

app.post('/api/models', (req, res) => {
  try {
    const { models, added } = addModel(req.body?.model);
    res.json({ models, added });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.post('/api/open-file', (req, res) => {
  const image = req.body?.image;
  const m = /^data:image\/(png|jpeg|jpg|webp|bmp);base64,(.+)$/s.exec(image ?? '');
  if (!m) return res.status(400).json({ error: 'Некорректные данные изображения' });
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const tmp = path.join(os.tmpdir(), `passportread_${Date.now()}.${ext}`);
  fs.writeFileSync(tmp, Buffer.from(m[2], 'base64'));
  openWithDefaultApp(tmp)
    .then(() => res.json({ ok: true }))
    .catch((e) => {
      console.error(e);
      res.status(500).json({ error: String(e?.message ?? e) });
    });
});

app.get('/api/health', (_req, res) => res.json({ ok: true, credentials: credentialsConfigured(), yandex: yandexConfigured(), defaultModel: DEFAULT_MODEL }));

app.post('/api/open-env', (_req, res) => {
  const envPath = path.resolve('..', '.env');
  if (!fs.existsSync(envPath)) {
    return res.status(404).json({ error: `Файл .env не найден: ${envPath}` });
  }
  openWithDefaultApp(envPath)
    .then(() => res.json({ ok: true }))
    .catch((e) => {
      console.error(e);
      res.status(500).json({ error: String(e?.message ?? e) });
    });
});

app.get('/api/prompts', (_req, res) => {
  try {
    ensurePrompts();
    const prompts = listPrompts();
    currentPrompt = currentPrompt && prompts.includes(currentPrompt) ? currentPrompt : prompts[0] ?? null;
    res.json({ prompts, current: currentPrompt });
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.get('/api/prompt', (req, res) => {
  try {
    const prompts = listPrompts();
    const name = req.query?.name ?? currentPrompt ?? prompts[0];
    if (!name || !prompts.includes(name)) {
      return res.status(404).json({ error: `Промпт не найден: ${name}` });
    }
    currentPrompt = name;
    res.json({ prompt: readPrompt(name), name });
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.post('/api/prompt', (req, res) => {
  try {
    const rawName = req.body?.name;
    const text = req.body?.prompt;
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Промпт не должен быть пустым' });
    }
    const name = sanitizePromptName(rawName);
    writePrompt(name, text);
    currentPrompt = name;
    res.json({ ok: true, name });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.post('/api/prompts', (req, res) => {
  try {
    const name = sanitizePromptName(req.body?.name);
    const exists = listPrompts().includes(name);
    if (!exists) {
      writePrompt(name, DEFAULT_PROMPT);
    }
    currentPrompt = name;
    res.json({ ok: true, name, created: !exists });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));