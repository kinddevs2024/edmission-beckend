# Локальная установка DeepSeek (без облака)

DeepSeek запускается **у тебя на компьютере** через Ollama. Никакого API-ключа не нужно.

---

## 1. Установить Ollama

**Windows:**

1. Скачай установщик: **https://ollama.com/download** → Windows.
2. Запусти `OllamaSetup.exe`, установи.
3. Ollama запустится в фоне (иконка в трее). API будет доступен по адресу `http://localhost:11434`.

**Через PowerShell (альтернатива):**

```powershell
irm https://ollama.com/install.ps1 | iex
```

---

## 2. Скачать модель DeepSeek

Открой **PowerShell** или **cmd** и выполни:

```bash
ollama pull deepseek-r1:8b
```

Скачается около 5 GB. Дождись окончания.

**Проверка:**

```bash
ollama list
ollama run deepseek-r1:8b "Привет!"
```

Если модель ответила — всё готово.

**Более лёгкий вариант** (меньше размер, быстрее на слабом ПК):

```bash
ollama pull deepseek-r1:1.5b
```

Тогда в `.env` бэкенда укажи: `OLLAMA_MODEL=deepseek-r1:1.5b`.

---

## 3. Настройка бэкенда

В `.env` бэкенда **не задавай** `DEEPSEEK_API_KEY` (или оставь пустым). Тогда бэкенд будет использовать локальный Ollama.

Должны быть заданы (или оставлены по умолчанию):

```env
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=deepseek-r1:8b
```

---

## 4. Запуск

1. Убедись, что **Ollama запущен** (после установки он обычно уже в фоне).
2. Запусти бэкенд: в папке `edmission-beckend` выполни `npm run dev`.
3. В логах должно появиться: `Ollama reachable — AI chat ready`.
4. Запусти фронт, открой чат в приложении — ответы идут с твоего компьютера через DeepSeek.

Готово: DeepSeek работает локально, без облака и без API-ключа.
