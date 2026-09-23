# Как опубликовать календарь и оставить доступ только себе

Заметка на будущее. Сейчас проект работает локально, публиковать его в текущем
виде нельзя.

## Почему нельзя просто выложить

`json-server` отдаёт всю базу по HTTP любому, кто знает адрес, и не умеет
проверять, кто пришёл. Экран входа поверх него ничего не закрывает: данные
лежат на том же адресе и доступны напрямую, минуя интерфейс.

Из этого следует главное: **менять нужно не авторизацию, а место хранения
данных.** Пароли в `db.json` тоже бессмысленны — файл читается кем угодно.

## Что уже играет нам на руку

Весь обмен с сервером изолирован:

- одна функция `request(url, options)` в [app.js](app.js), 11 вызовов;
- два адреса в константах `API_URL` и `PROJECTS_URL` в первых строках файла.

Интерфейс, режимы, повторы, перетаскивание — ничего этого миграция не касается.
Меняется только слой запросов.

---

## Путь A. Supabase — если нужна синхронизация между устройствами

Бесплатный Postgres с авторизацией и правилами доступа на уровне базы.
Вход по почте с кодом работает из коробки — это то, что хотелось изначально.
Вход по SMS платный: нужен отдельный аккаунт Twilio.

### Шаги

1. Завести проект на supabase.com, получить `URL` и `anon key`.
2. Создать таблицы. Осторожно с именами колонок:
   - `order` — зарезервированное слово в SQL, переименовать в `position`;
   - `date` — сбивает с толку, лучше `planned_date`;
   - camelCase в Postgres требует кавычек в каждом запросе — перевести всё
     в snake_case и сопоставлять с полями объекта в клиенте.

   ```sql
   create table projects (
     id uuid primary key default gen_random_uuid(),
     user_id uuid not null references auth.users on delete cascade,
     name text not null,
     color text not null default 'gray'
   );

   create table tasks (
     id uuid primary key default gen_random_uuid(),
     user_id uuid not null references auth.users on delete cascade,
     text text not null,
     completed boolean not null default false,
     completed_dates text[] not null default '{}',
     skip_dates text[] not null default '{}',
     extra_dates text[] not null default '{}',
     planned_date date not null,
     deadline date,
     project_id uuid references projects on delete set null,
     repeat jsonb,
     position int not null default 0
   );
   ```

3. **Включить Row Level Security — без этого база остаётся открытой.**

   ```sql
   alter table tasks enable row level security;
   alter table projects enable row level security;

   create policy "свои задачи" on tasks
     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

   create policy "свои проекты" on projects
     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
   ```

   После этого никакой ключ из клиентского кода чужие строки не покажет:
   фильтрация происходит в базе, а не в браузере.

4. В коде:
   - подключить `@supabase/supabase-js` через CDN;
   - заменить тело `request()` на вызовы клиента Supabase — остальные
     11 мест трогать не придётся, если сохранить сигнатуру;
   - при создании задач и проектов проставлять `user_id`;
   - добавить экран входа: `signInWithOtp({ email })` присылает код на почту,
     `verifyOtp` его проверяет.

5. Выложить статику на GitHub Pages, Netlify или Vercel. Ключ `anon key`
   в коде — это нормально и так задумано: доступ ограничивают политики RLS,
   а не секретность ключа.

### Перенос текущих данных

`db.json` → SQL-вставки скриптом на Python: сопоставить поля, подставить
свой `user_id`, прогнать через SQL-редактор Supabase.

---

## Путь B. Данные в браузере — если синхронизация не нужна

Самый быстрый вариант. Сайт публикуется, но данные никуда не уходят:
они лежат в `localStorage` того браузера, где ты работаешь.

- Заменить тело `request()` на чтение и запись `localStorage`,
  сохранив ту же сигнатуру.
- Идентификаторы генерировать через `crypto.randomUUID()`.
- Авторизация не нужна вообще: чужой браузер просто откроет пустой календарь.

Минусы честные: данные привязаны к одному браузеру, очистка данных сайта
стирает всё, между телефоном и ноутбуком ничего не синхронизируется.
Стоит сразу сделать экспорт в файл и импорт обратно.

---

## Чего делать не стоит

- Прикручивать форму входа поверх `json-server` — это декорация,
  данные останутся открытыми.
- Хранить пароли в `db.json` в любом виде, включая хеши.
- Класть ключи провайдера SMS или почты в клиентский код — их увидит любой,
  кто откроет исходники страницы.
