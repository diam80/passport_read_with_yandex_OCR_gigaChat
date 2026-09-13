# PassportRead — распознавание паспорта РФ с фото

Веб-приложение и CLI-утилита для распознавания паспорта гражданина РФ по фотографии.
Работает через два независимых сервиса:

- **GigaChat Vision** — модель читает фото и возвращает поля по промпту (`prompt_*.txt`)
- **Yandex OCR** — шаблонная модель `passport` распознаёт документ и отдаёт структурированные поля

## Возможности

- Веб-интерфейс: перетащите фото, выберите сервис — и получите поля паспорта
- Yandex OCR: выбор из 12 моделей (паспорт, ВУ, СТС, номера авто, печатный/рукописный текст, таблицы и т.д.), ответ выводится текстом + сырым JSON для отладки
- GigaChat: редактируемые промпты (сохраняются в `prompt_<название>.txt`), выбор модели, карточки/таблица, скопировать JSON с учётом правок
- Поля можно перетаскивать между строками
- CLI-режим: распознать фото одной командой

## Требования

- Node.js **≥ 20.11** (используется `import.meta.dirname` и встроенный `fetch`)
- Доступы к одному из сервисов (или сразу к обоим):
  - GigaChat: [регистрация в developers.sber.ru](https://developers.sber.ru/docs/ru/gigachat/quickstart/ind-create-project)
  - Yandex OCR: API-ключ и ID каталога (см. «Регистрация в яндекс.txt»)

## Настройка

Создайте файл `.env` в папке, расположенной **уровнем выше проекта** (сервер читает `../.env`):

```
Client ID:
<client_id>

Client Secret:
<client_secret>

Scope:
GIGACHAT_API_PERS

Authorization Key:
<auth_key>

YANDEX_FOLDER_ID:
<folder_id>

YANDEX_API_KEY:
<api_key>
```

`Authorization Key` — base64 от `Client ID:Client Secret`. Если его нет,
приложение соберёт его из первых двух полей автоматически.
GigaChat-поля либо `Authorization Key`, либо `Client ID` + `Client Secret` обязательны;
Yandex-поля нужны только для кнопки «Распознать (Yandex OCR)».

## Запуск

### Веб-интерфейс

```bash
node server.js
```

Откройте http://localhost:3000. На Windows можно запустить `start-passport.bat`.

### CLI

```bash
node passport-read.js путь\к\фото.jpg
```

CLI использует первый найденный `prompt_*.txt` и модель из переменной окружения
`GIGACHAT_MODEL` (по умолчанию `GigaChat-2-Pro`) через GigaChat.

## Как это работает

**GigaChat**: изображение загружается через `chat.uploadFile`, в запрос подставляется
промпт, который требует вернуть чистый JSON с полями паспорта. Промпты редактируются
прямо в веб-интерфейсе.

**Yandex OCR**: запрос на `https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText`
с моделью `passport` (или другой из списка). Ответ (`result.textAnnotation`) содержит
`entities` — пары `поле → значение`, например `surname`, `birth_date`, `issued_by`,
плюс `fullText` и координаты блоков.

## Структура

```
passport-read.js           CLI (GigaChat)
server.js                  Express-сервер: UI + оба API (GigaChat / Yandex OCR)
index.html                 Веб-интерфейс
prompt_*.txt               Промпты для GigaChat (редактируются из UI)
prompt_Паспорт.txt         Классический промпт паспорта РФ
prompt_Стандартный.txt     Промпт по умолчанию
models.txt                 Список моделей GigaChat
start-passport.bat         Быстрый запуск сервера на Windows
Инструкция.txt             Краткая инструкция по настройке
Регистрация в яндекс.txt   Как получить доступ к Yandex OCR
```

## API сервера

| Метод | Путь | Описание |
| --- | --- | --- |
| POST | `/api/recognize` | Распознавание через GigaChat (промпт + модель) |
| POST | `/api/recognize-yandex` | Распознавание через Yandex OCR (модель `passport` и др.) |
| GET/POST | `/api/models`, `/api/prompts`, `/api/prompt` | Управление моделями и промптами |
| GET | `/api/health` | Статус и наличие ключей в `.env` |

## Лицензия

MIT