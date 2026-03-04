# Установка Ollama и DeepSeek на сервере — пошагово

Подключаешься к серверу по SSH, открываешь терминал. Дальше — по шагам.

---

## Шаг 1. Подключиться к серверу

В своём терминале (PowerShell, cmd или Mac/Linux):

```bash
ssh root@IP_ТВОЕГО_СЕРВЕРА
```

(или `ssh user@IP_ТВОЕГО_СЕРВЕРА`, если заходишь не под root).  
Дальше все команды выполняются уже на сервере.

---

## Шаг 2. Установить Ollama

Выполни одну команду (скачает и установит Ollama):

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Дождись окончания. Должно появиться что-то вроде «Ollama is installed».

Проверка:

```bash
ollama --version
```

Если версия выводится — Ollama установлена.

---

## Шаг 3. Сделать Ollama сервисом (чтобы работала после перезагрузки)

Создай пользователя и группу для Ollama:

```bash
sudo useradd -r -s /bin/false -U -m -d /usr/share/ollama ollama
sudo usermod -a -G ollama $(whoami)
```

Создай файл сервиса:

```bash
sudo nano /etc/systemd/system/ollama.service
```

Вставь в файл (Ctrl+Shift+V или правой кнопкой → Вставить):

```ini
[Unit]
Description=Ollama Service
After=network-online.target

[Service]
ExecStart=/usr/local/bin/ollama serve
User=ollama
Group=ollama
Restart=always
RestartSec=3
Environment="PATH=/usr/local/bin:/usr/bin:/bin"

[Install]
WantedBy=multi-user.target
```

Сохрани: `Ctrl+O`, Enter, выход: `Ctrl+X`.

Если у тебя `ollama` установлена не в `/usr/local/bin`, узнай путь:

```bash
which ollama
```

И в `ExecStart=` подставь этот путь (например `ExecStart=/usr/bin/ollama serve`).

Включи и запусти сервис:

```bash
sudo systemctl daemon-reload
sudo systemctl enable ollama
sudo systemctl start ollama
```

Проверь, что Ollama запущена:

```bash
sudo systemctl status ollama
```

Должно быть `active (running)`. Выход из статуса: `q`.

---

## Шаг 4. Скачать модель DeepSeek

Одна команда (качает около 5 GB, может занять несколько минут):

```bash
ollama pull deepseek-r1:8b
```

Проверка:

```bash
ollama list
```

В списке должна быть строка с `deepseek-r1:8b`.

Проверка ответа модели:

```bash
ollama run deepseek-r1:8b "Привет!"
```

Если модель ответила — DeepSeek на сервере работает.

---

## Шаг 5. Настроить бэкенд Edmission

Зайди в папку проекта на сервере (где лежит бэкенд), например:

```bash
cd /var/www/edmission/edmission-beckend
```

(или твой реальный путь к папке бэкенда).

Открой `.env`:

```bash
nano .env
```

Сделай так:

1. **Не используем облачный API** — ключ DeepSeek не нужен. Строка может быть пустой или закомментирована:
   ```env
   DEEPSEEK_API_KEY=
   ```

2. **Ollama на этом же сервере** — в `.env` должны быть:
   ```env
   OLLAMA_BASE_URL=http://localhost:11434
   OLLAMA_MODEL=deepseek-r1:8b

# На сервере без GPU (CPU-only) ответы долгие — увеличь таймаут (в миллисекундах)
AI_CHAT_TIMEOUT_MS=180000
   ```

Сохрани: `Ctrl+O`, Enter, выход: `Ctrl+X`.

---

## Шаг 6. Перезапустить бэкенд

Как ты обычно перезапускаешь приложение (PM2, systemd, Docker — что используешь).

**Пример через PM2:**

```bash
pm2 restart edmission-beckend
# или как у тебя называется процесс
pm2 list
```

**Пример через systemd (если бэкенд — сервис):**

```bash
sudo systemctl restart edmission-backend
```

**Пример через Docker:**

```bash
docker compose restart backend
# или
docker restart имя_контейнера_бэкенда
```

После перезапуска бэкенд будет ходить в Ollama по `http://localhost:11434` и использовать модель `deepseek-r1:8b`.

---

## Шаг 7. Проверить

1. В логах бэкенда при старте должно появиться что-то вроде:  
   `Ollama reachable — AI chat ready` (или аналогичное сообщение об успешной проверке Ollama).

2. В приложении открой чат (Edmission AI), отправь сообщение — ответ должен приходить от локального DeepSeek на сервере.

---

## Сервер без GPU (CPU-only)

Ollama в режиме CPU генерирует ответы **медленно**. DeepSeek R1 8B на CPU может отвечать 2–5 минут. Поэтому:

1. **Увеличь таймаут** в `.env`:
   ```env
   AI_CHAT_TIMEOUT_MS=300000
   ```
   (300000 мс = 5 минут)

2. **Либо перейди на лёгкую модель** — она быстрее:
   ```bash
   ollama pull deepseek-r1:1.5b
   ```
   В `.env` укажи: `OLLAMA_MODEL=deepseek-r1:1.5b`

3. Перезапусти бэкенд: `pm2 restart edmission-back`

---

## Если что-то пошло не так

- **Ollama не стартует**  
  Логи:  
  `journalctl -e -u ollama`

- **Бэкенд не видит Ollama**  
  Убедись, что бэкенд запущен на том же сервере, где Ollama, и в `.env` указано `OLLAMA_BASE_URL=http://localhost:11434`.

- **Мало места на диске**  
  Модель deepseek-r1:8b занимает около 5 GB. Проверка:  
  `df -h`

- **Более лёгкая модель (меньше RAM/диска)**  
  Вместо 8B можно использовать 1.5B:  
  `ollama pull deepseek-r1:1.5b`  
  И в `.env`:  
  `OLLAMA_MODEL=deepseek-r1:1.5b`
