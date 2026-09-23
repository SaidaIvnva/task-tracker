const API_URL = 'http://localhost:3000/tasks';
const PROJECTS_URL = 'http://localhost:3000/projects';

// Псевдопроект «все»: не существует на сервере, только режим показа
const ALL_PROJECTS = 'all';

const form = document.querySelector('.form');
const input = document.querySelector('#text');
const list = document.querySelector('.tasks');
const counter = document.querySelector('.tasks-counter');
const doneSection = document.querySelector('.done-section');
const doneList = document.querySelector('.tasks-done');
const doneCounter = document.querySelector('.done-counter');
const main = document.querySelector('main');
const strip = document.querySelector('.days-strip');
const todayButton = document.querySelector('.days-today');
const dayPicker = document.querySelector('.days-picker');
const tasksTitle = document.querySelector('.tasks-title');
const deadlineInput = document.querySelector('#deadline');
const plannedInput = document.querySelector('#planned');
const projectsList = document.querySelector('.projects-list');
const projectsArrowStart = document.querySelector('.projects-arrow-start');
const projectsArrowEnd = document.querySelector('.projects-arrow-end');
const projectSelect = document.querySelector('#project');
const repeatSelect = document.querySelector('#repeat');
const repeatDays = document.querySelector('#repeat-days');
const dayView = document.querySelector('.day-view');
const weekView = document.querySelector('.week-view');
const weekGrid = document.querySelector('.week');
const weeksStrip = document.querySelector('.weeks-strip');
const weeksTodayButton = document.querySelector('.weeks-today');
const editor = document.querySelector('.editor');
const asker = document.querySelector('.ask');
const errorBox = document.querySelector('.error');

// Ключи хранилища объявлены здесь, выше первого использования:
// const попадает во временную мёртвую зону, и обращение снизу упало бы.
// sessionStorage, а не localStorage: в новой вкладке всё начинается заново.
const DONE_OPEN_KEY = 'tracker:doneOpen';
const DAY_KEY = 'tracker:day';
const PROJECT_KEY = 'tracker:project';
const MODE_KEY = 'tracker:mode';
const SCROLL_KEY = 'tracker:scroll';
const WEEK_SCROLL_KEY = 'tracker:weekScroll';

let tasks = [];
let projects = [];

// Выбранный проект, тоже переживает перезагрузку вкладки
let selectedProject = readStored(PROJECT_KEY, ALL_PROJECTS);

// День, который сейчас открыт. Меняется крутилкой, стрелками, календарём
// и кликом по соседям. Переживает перезагрузку вкладки: live-reload
// дев-сервера перезагружает страницу после каждой записи в db.json,
// и без этого человека выбрасывало бы обратно в сегодня.
let selectedDate = readSelectedDate();

// 'day' или 'week' — тоже переживает перезагрузку вкладки
let viewMode = readStored(MODE_KEY, 'day') === 'week' ? 'week' : 'day';

// Состояние секции «Уже сделанные» переживает перезагрузку вкладки:
// live-reload дев-сервера перезагружает страницу после каждой записи
// в db.json, и без этого папка каждый раз схлопывалась бы.
// Обращения к хранилищу обёрнуты: в приватном режиме и при открытии
// страницы с диска оно может бросить, а это верхний уровень скрипта —
// исключение здесь снесло бы всё приложение.
function readStored(key, fallback) {
  try {
    return sessionStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveStored(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // хранилище недоступно — переживём, просто без запоминания
  }
}

// В хранилище может оказаться мусор: проверяем формат, иначе берём сегодня
function readSelectedDate() {
  const stored = readStored(DAY_KEY, '');
  return /^\d{4}-\d{2}-\d{2}$/.test(stored) ? stored : todayISO();
}

let doneOpen = readStored(DONE_OPEN_KEY, 'false') === 'true';

doneSection.addEventListener('toggle', () => {
  doneOpen = doneSection.open;
  saveStored(DONE_OPEN_KEY, String(doneOpen));
});

/* Запросы */

async function request(url, options) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const error = new Error(`Сервер ответил ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

async function loadTasks() {
  tasks = await request(API_URL);
  render();
}

// 404 здесь значит не «нет сервера», а «нет раздела projects в db.json» —
// сообщение должно говорить, что делать, иначе оно сбивает с толку.
const NO_PROJECTS_HINT = 'В db.json нет раздела projects. Остановите json-server, добавьте в файл строку "projects": [] и запустите снова.';

function showProjectError(error) {
  showError(error.status === 404 ? NO_PROJECTS_HINT : error);
}

async function loadProjects() {
  try {
    projects = await request(PROJECTS_URL);
  } catch (error) {
    projects = [];
    showProjectError(error);
  }

  renderProjects();
  renderProjectOptions();
}

async function addProject(name, color) {
  const created = await request(PROJECTS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, color }),
  });

  projects.push(created);
  renderProjects();
  renderProjectOptions();
}

async function deleteProject(id) {
  // Сначала отвязываем задачи, иначе они остались бы с битой ссылкой
  const orphans = tasks.filter((task) => String(task.projectId) === id);

  await Promise.all(orphans.map((task) => request(`${API_URL}/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: null }),
  })));

  await request(`${PROJECTS_URL}/${id}`, { method: 'DELETE' });

  projects = projects.filter((project) => String(project.id) !== id);
  tasks = tasks.map((task) => (String(task.projectId) === id ? { ...task, projectId: null } : task));

  if (selectedProject === id) {
    selectedProject = ALL_PROJECTS;
    saveStored(PROJECT_KEY, selectedProject);
  }

  renderProjects();
  renderProjectOptions();
  render();
}

async function addTask(text, deadline, date, projectId, repeat) {
  // Без номера новая задача попала бы к нулевым, то есть в середину списка;
  // ставим её после всех
  const order = tasks.reduce((max, task) => Math.max(max, task.order ?? 0), 0) + 1;

  const created = await request(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      completed: false,
      completedDates: [],
      skipDates: [],
      deadline,
      date,
      projectId,
      repeat,
      order,
    }),
  });

  tasks.push(created);
  render();
  return created;
}

async function toggleTask(id, completed, iso) {
  const current = tasks.find((task) => String(task.id) === id);

  // У повторяющейся задачи галочка ставится на конкретный день,
  // иначе отметка в понедельник погасила бы её во все остальные дни
  let fields;

  if (current?.repeat) {
    const dates = new Set(current.completedDates ?? []);
    dates[completed ? 'add' : 'delete'](iso);
    fields = { completedDates: [...dates].sort() };
  } else {
    fields = { completed };
  }

  const updated = await request(`${API_URL}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });

  tasks = tasks.map((task) => (String(task.id) === id ? updated : task));
  render();
}

// Порядок задаётся номерами по видимому списку. Меняем только те задачи,
// у которых номер реально сдвинулся, — остальные трогать незачем.
async function saveOrder(orderedIds) {
  const changed = [];

  orderedIds.forEach((id, index) => {
    const task = tasks.find((item) => String(item.id) === id);

    if (task && (task.order ?? 0) !== index) {
      task.order = index;
      changed.push({ id, order: index });
    }
  });

  if (changed.length === 0) {
    return;
  }

  render();

  try {
    hideError();

    await Promise.all(changed.map(({ id, order }) => request(`${API_URL}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    })));
  } catch (error) {
    showError(error);
    await loadTasks();
  }
}

// Задача может уйти мимо текущих фильтров — в другой день или в другой
// проект — и тогда просто исчезнет с экрана. Показываем её там, где она есть.
function revealTask(task) {
  const date = plannedDate(task);

  const dateVisible = viewMode === 'week'
    ? weekDays(selectedDate).includes(date)
    : date === selectedDate;

  const projectVisible = matchesProject(task);

  if (dateVisible && projectVisible) {
    return;
  }

  if (!projectVisible) {
    selectedProject = task.projectId ? String(task.projectId) : ALL_PROJECTS;
    saveStored(PROJECT_KEY, selectedProject);
    renderProjects();
    renderProjectOptions();
  }

  if (dateVisible) {
    render();
  } else {
    selectDate(date);
  }
}

async function editTask(id, fields) {
  const updated = await request(`${API_URL}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });

  tasks = tasks.map((task) => (String(task.id) === id ? updated : task));
  render();
}

// Убрать одно повторение: исходная задача просто перестаёт появляться в этот день
async function skipOccurrence(task, iso) {
  const updated = await request(`${API_URL}/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skipDates: [...(task.skipDates ?? []), iso] }),
  });

  tasks = tasks.map((item) => (item.id === task.id ? updated : item));
  render();
}

// Правка одного повторения: исходное правило пропускает этот день,
// а вместо него заводится отдельная разовая задача с изменениями
async function detachOccurrence(task, iso, fields) {
  await request(`${API_URL}/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skipDates: [...(task.skipDates ?? []), iso] }),
  });

  // В форме поле «В работу» показывает начало правила, а не открытый день.
  // Если его не меняли, отцепленная задача должна встать именно в тот день,
  // который редактировали, иначе она уедет к началу повтора.
  const date = fields.date === plannedDate(task) ? iso : fields.date;

  await request(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...fields,
      date,
      completed: isCompletedOn(task, iso),
      completedDates: [],
      skipDates: [],
      repeat: null,
      order: task.order ?? 0,
    }),
  });

  await loadTasks();
}

async function deleteTask(id) {
  await request(`${API_URL}/${id}`, { method: 'DELETE' });

  tasks = tasks.filter((task) => String(task.id) !== id);
  render();
}

/* Дни */

function toISO(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function todayISO() {
  return toISO(new Date());
}

// setDate сам перекидывает через границы месяца и года
function shiftISO(iso, days) {
  const date = parseDate(iso);
  date.setDate(date.getDate() + days);
  return toISO(date);
}

// У задач, созданных до появления дней, поля date нет — считаем их сегодняшними
function plannedDate(task) {
  return task.date ?? todayISO();
}

// Задача живёт ровно в том дне, на который назначена. Дедлайн на видимость
// не влияет — иначе задача показывалась бы дважды: в своём дне и в дне срока.
// Срок виден цветом метки.
function tasksForDate(iso) {
  const found = tasks.filter((task) => {
    if (!matchesProject(task)) {
      return false;
    }

    return task.repeat ? repeatsOn(task, iso) : plannedDate(task) === iso;
  });

  // sort стабильна: задачи без порядка сохраняют исходную очерёдность
  return found.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function matchesProject(task) {
  return selectedProject === ALL_PROJECTS || String(task.projectId ?? '') === selectedProject;
}

const PROJECT_COLORS = ['blue', 'green', 'amber', 'coral', 'red', 'purple', 'gray'];

function findProject(id) {
  return projects.find((project) => String(project.id) === String(id)) ?? null;
}

function projectName(id) {
  return findProject(id)?.name ?? null;
}

// У проектов, заведённых до появления цветов, поля нет — считаем их серыми
function projectColor(id) {
  const color = findProject(id)?.color;
  return PROJECT_COLORS.includes(color) ? color : 'gray';
}

function titleForDate(iso) {
  const today = todayISO();

  if (iso === today) {
    return 'Сегодня';
  }

  if (iso === shiftISO(today, -1)) {
    return 'Вчера';
  }

  if (iso === shiftISO(today, 1)) {
    return 'Завтра';
  }

  return parseDate(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function selectDate(iso) {
  selectedDate = iso;
  saveStored(DAY_KEY, iso);
  plannedInput.value = iso;
  renderDays();
  render();
}

function createDayElement(iso, offset) {
  const date = parseDate(iso);

  const item = document.createElement('button');
  item.type = 'button';
  item.className = offset === 0 ? 'day day-current' : 'day day-near';
  item.dataset.date = iso;
  item.setAttribute('aria-label', date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }));

  if (offset === 0) {
    item.setAttribute('aria-current', 'date');
    item.title = 'Выбрать дату';
    item.setAttribute('aria-label', `Выбрать дату. Открыт день: ${item.getAttribute('aria-label')}`);
  }

  if (iso === todayISO()) {
    item.classList.add('day-today');
  }

  const weekday = document.createElement('span');
  weekday.className = 'day-weekday';
  weekday.textContent = date.toLocaleDateString('ru-RU', { weekday: 'short' });

  const number = document.createElement('span');
  number.className = 'day-number';
  number.textContent = date.getDate();

  const month = document.createElement('span');
  month.className = 'day-month';
  month.textContent = date.toLocaleDateString('ru-RU', { month: 'short' });

  item.append(weekday, number, month);
  return item;
}

function createEditField(caption, className, value) {
  const field = document.createElement('label');
  field.className = 'field';

  const title = document.createElement('span');
  title.className = 'field-label';
  title.textContent = caption;

  const input = document.createElement('input');
  input.type = 'date';
  input.className = className;
  input.value = value;

  field.append(title, input);
  return field;
}

function createEditForm(task) {
  const form = document.createElement('form');
  form.className = 'task-edit';
  form.dataset.id = task.id;

  const text = document.createElement('input');
  text.type = 'text';
  text.className = 'task-edit-text';
  text.value = task.text;
  text.setAttribute('aria-label', 'Название задачи');

  const repeatField = document.createElement('label');
  repeatField.className = 'field';

  const repeatCaption = document.createElement('span');
  repeatCaption.className = 'field-label';
  repeatCaption.textContent = 'Повтор';

  const repeatPicker = document.createElement('select');
  repeatPicker.className = 'task-edit-repeat';
  repeatPicker.replaceChildren(...[['', 'Не повторять'], ...Object.entries(REPEAT_LABELS)].map(([value, caption]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = caption;
    return option;
  }));
  repeatPicker.value = task.repeat?.type ?? '';

  repeatField.append(repeatCaption, repeatPicker);

  const repeatChips = document.createElement('fieldset');
  repeatChips.className = 'weekdays task-edit-days';
  buildWeekdayChips(repeatChips, task.repeat?.days ?? []);
  repeatChips.hidden = repeatPicker.value !== 'custom';

  repeatPicker.addEventListener('change', () => syncRepeatDays(repeatPicker, repeatChips));

  const projectField = document.createElement('label');
  projectField.className = 'field';

  const projectCaption = document.createElement('span');
  projectCaption.className = 'field-label';
  projectCaption.textContent = 'Проект';

  const projectPicker = document.createElement('select');
  projectPicker.className = 'task-edit-project';
  fillProjectOptions(projectPicker, task.projectId === null || task.projectId === undefined ? '' : String(task.projectId));

  projectField.append(projectCaption, projectPicker);

  const dates = document.createElement('div');
  dates.className = 'task-edit-dates';
  dates.append(
    createEditField('В работу', 'task-edit-planned', plannedDate(task)),
    createEditField('Дедлайн', 'task-edit-deadline', task.deadline ?? ''),
    projectField,
    repeatField,
  );

  const save = document.createElement('button');
  save.type = 'submit';
  save.textContent = 'Сохранить';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'task-edit-cancel';
  cancel.textContent = 'Отмена';

  const actions = document.createElement('div');
  actions.className = 'task-edit-actions';
  actions.append(save, cancel);

  const title = document.createElement('h2');
  title.className = 'editor-title';
  title.textContent = 'Задача';

  form.append(title, text, dates, repeatChips, actions);
  return form;
}

function openEditor(id, iso) {
  const task = tasks.find((item) => String(item.id) === id);

  if (!task) {
    return;
  }

  const form = createEditForm(task);
  form.dataset.date = iso;
  editor.replaceChildren(form);
  editor.showModal();

  const field = editor.querySelector('.task-edit-text');
  field.focus();
  field.select();
}

function closeEditor() {
  if (editor.open) {
    editor.close();
  }
}

// Календарь открываем у настоящего <input type="date">: он остаётся в потоке,
// но не виден — showPicker() не сработает на display: none.
// Поле лежит в main и перед показом переставляется под нажатый элемент,
// иначе браузер выкидывает календарь в угол экрана.
// Ставим поле под элемент. Вызывается и при отрисовке полос, чтобы к
// первому клику после перезагрузки поле уже стояло на месте.
function positionPicker(anchor) {
  if (!anchor) {
    return;
  }

  const host = main.getBoundingClientRect();
  const box = anchor.getBoundingClientRect();

  dayPicker.style.left = `${box.left - host.left}px`;
  dayPicker.style.top = `${box.bottom - host.top}px`;
}

function openDayPicker(anchor) {
  positionPicker(anchor);

  // Принудительный пересчёт вёрстки. Без него браузер берёт позицию,
  // которая была у поля до присвоения стилей, и при первом вызове
  // показывает календарь в углу страницы.
  void dayPicker.offsetHeight;

  dayPicker.value = selectedDate;

  try {
    dayPicker.showPicker();
  } catch {
    // старый браузер или отказ в показе — остаётся обычный клик по полю
    dayPicker.focus();
    dayPicker.click();
  }
}

function renderDays() {
  strip.replaceChildren(...[-1, 0, 1].map((offset) => createDayElement(shiftISO(selectedDate, offset), offset)));
  todayButton.hidden = selectedDate === todayISO();

  if (viewMode === 'day') {
    positionPicker(strip.querySelector('.day-current'));
  }
}

/* Недельный вид */

// Неделя считается с понедельника: getDay() отдаёт 0 для воскресенья
function weekStart(iso) {
  const day = parseDate(iso).getDay();
  return shiftISO(iso, day === 0 ? -6 : 1 - day);
}

function weekDays(iso) {
  const start = weekStart(iso);
  return Array.from({ length: 7 }, (unused, offset) => shiftISO(start, offset));
}

function weekLabelText(iso) {
  const days = weekDays(iso);
  const first = parseDate(days[0]);
  const last = parseDate(days[6]);
  const sameMonth = first.getMonth() === last.getMonth();

  const from = first.toLocaleDateString('ru-RU', sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
  const to = last.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

  return `${from} — ${to}`;
}

function createWeekItem(iso, offset) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = offset === 0 ? 'week-item week-item-current' : 'week-item week-item-near';
  item.dataset.date = iso;
  item.textContent = weekLabelText(iso);

  if (weekStart(iso) === weekStart(todayISO())) {
    item.classList.add('week-item-today');
  }

  if (offset === 0) {
    item.setAttribute('aria-current', 'true');
    item.title = 'Выбрать неделю';
    item.setAttribute('aria-label', `Выбрать неделю. Открыта: ${item.textContent}`);
  } else {
    item.setAttribute('aria-label', `Неделя ${item.textContent}`);
  }

  return item;
}

function renderWeeks() {
  weeksStrip.replaceChildren(
    ...[-7, 0, 7].map((shift) => createWeekItem(shiftISO(selectedDate, shift), shift === 0 ? 0 : shift)),
  );

  weeksTodayButton.hidden = weekStart(selectedDate) === weekStart(todayISO());
  positionPicker(weeksStrip.querySelector('.week-item-current'));
}

function createWeekColumn(iso) {
  const date = parseDate(iso);

  const column = document.createElement('section');
  column.className = 'week-day';

  if (iso === todayISO()) {
    column.classList.add('week-day-today');
  }

  const head = document.createElement('h2');
  head.className = 'week-day-head';

  const name = document.createElement('span');
  name.className = 'week-day-name';
  name.textContent = date.toLocaleDateString('ru-RU', { weekday: 'short' });

  const number = document.createElement('span');
  number.className = 'week-day-number';
  number.textContent = date.getDate();

  head.append(name, number);

  const list = document.createElement('ul');
  list.className = 'tasks week-tasks';

  // Выполненные опускаем в конец колонки; порядок внутри групп сохраняется
  const items = tasksForDate(iso)
    .sort((a, b) => Number(isCompletedOn(a, iso)) - Number(isCompletedOn(b, iso)));

  list.replaceChildren(
    ...(items.length === 0 ? [createEmptyElement('—')] : items.map((task) => createTaskElement(task, iso))),
  );

  column.append(head, list);
  return column;
}

function renderWeek() {
  // replaceChildren обнуляет прокрутку, поэтому возвращаем её на место:
  // иначе отметка галочки в пятничной колонке кидала бы к понедельнику
  const left = weekGrid.scrollLeft;

  renderWeeks();
  weekGrid.replaceChildren(...weekDays(selectedDate).map(createWeekColumn));

  weekGrid.scrollLeft = left;
}

// Live-reload дев-сервера перезагружает страницу после каждой записи в
// db.json. Штатное восстановление прокрутки браузером тут не срабатывает:
// в момент восстановления задачи ещё не загружены и страница короткая.
function saveScroll() {
  saveStored(SCROLL_KEY, String(Math.round(window.scrollY)));
  saveStored(WEEK_SCROLL_KEY, String(Math.round(weekGrid.scrollLeft)));
}

function restoreScroll() {
  const left = Number(readStored(WEEK_SCROLL_KEY, '0'));
  const top = Number(readStored(SCROLL_KEY, '0'));

  if (Number.isFinite(left)) {
    weekGrid.scrollLeft = left;
  }

  if (Number.isFinite(top)) {
    window.scrollTo(0, top);
  }
}

function applyMode() {
  main.dataset.mode = viewMode;
  dayView.hidden = viewMode !== 'day';
  weekView.hidden = viewMode !== 'week';

  for (const button of document.querySelectorAll('.mode')) {
    button.classList.toggle('mode-active', button.dataset.mode === viewMode);
    button.setAttribute('aria-pressed', String(button.dataset.mode === viewMode));
  }
}

function setMode(mode) {
  viewMode = mode;
  saveStored(MODE_KEY, mode);
  applyMode();
  render();
  updateProjectsScroll();
}

/* Вопрос с несколькими вариантами */

// Возвращает value выбранной кнопки либо null, если окно закрыли
function ask(message, options) {
  return new Promise((resolve) => {
    const text = document.createElement('p');
    text.className = 'ask-text';
    text.textContent = message;

    const actions = document.createElement('div');
    actions.className = 'ask-actions';

    let answer = null;

    actions.append(...options.map((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = option.kind === 'danger' ? 'ask-danger' : '';
      button.textContent = option.label;

      button.addEventListener('click', () => {
        answer = option.value;
        asker.close();
      });

      return button;
    }));

    asker.replaceChildren(text, actions);

    // close срабатывает и на Escape, и на клик по кнопке
    asker.addEventListener('close', () => resolve(answer), { once: true });
    asker.showModal();
  });
}

asker.addEventListener('click', (event) => {
  if (event.target === asker) {
    asker.close();
  }
});

/* Повторы */

const REPEAT_LABELS = {
  daily: 'Каждый день',
  weekly: 'Каждую неделю',
  monthly: 'Каждый месяц',
  weekdays: 'По будням',
  weekends: 'В выходные',
  custom: 'Свой выбор',
};

// Пн первым, как принято здесь; getDay() отдаёт 0 для воскресенья
const WEEKDAYS = [
  { value: 1, short: 'Пн' },
  { value: 2, short: 'Вт' },
  { value: 3, short: 'Ср' },
  { value: 4, short: 'Чт' },
  { value: 5, short: 'Пт' },
  { value: 6, short: 'Сб' },
  { value: 0, short: 'Вс' },
];

// Нулевой день следующего месяца — это последний день текущего
function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

// Повторяющаяся задача не размножается в базе: хранится одно правило,
// а в каждом подходящем дне показывается как отдельная строка.
function repeatsOn(task, iso) {
  if (!task.repeat) {
    return false;
  }

  const start = plannedDate(task);

  // Строки ISO сравниваются лексикографически, это и есть сравнение дат
  if (iso < start) {
    return false;
  }

  // Дни, из которых повторение удалили или отцепили правкой
  if ((task.skipDates ?? []).includes(iso)) {
    return false;
  }

  const day = parseDate(iso).getDay();

  switch (task.repeat.type) {
    case 'daily':
      return true;
    case 'weekdays':
      return day >= 1 && day <= 5;
    case 'weekends':
      return day === 0 || day === 6;
    case 'weekly':
      return day === parseDate(start).getDay();
    case 'monthly': {
      // Если в месяце нет такого числа, повтор прижимается к последнему дню:
      // задача на 31-е в феврале выпадает на 28-е, а в високосный год на 29-е
      const date = parseDate(iso);
      const target = Math.min(parseDate(start).getDate(), daysInMonth(date.getFullYear(), date.getMonth()));
      return date.getDate() === target;
    }
    case 'custom':
      return (task.repeat.days ?? []).includes(day);
    default:
      return false;
  }
}

// У одноразовой задачи выполнение одно, у повторяющейся — своё на каждый день
function isCompletedOn(task, iso) {
  return task.repeat ? (task.completedDates ?? []).includes(iso) : Boolean(task.completed);
}

// Только описание расписания, без слова «повторяется»: оно подставляется
// в тексте снаружи, и раньше для «своего выбора» выходило дважды
function repeatSummary(task) {
  const rule = task.repeat;

  if (rule.type !== 'custom') {
    return (REPEAT_LABELS[rule.type] ?? 'по расписанию').toLowerCase();
  }

  const names = WEEKDAYS
    .filter((day) => (rule.days ?? []).includes(day.value))
    .map((day) => day.short.toLowerCase());

  return names.length === 0 ? 'по расписанию' : names.join(', ');
}

function repeatTitle(task) {
  return `Повторяется: ${repeatSummary(task)}`;
}

// Чипсы с днями недели для формы создания и для формы правки
function buildWeekdayChips(container, selected) {
  container.replaceChildren(...WEEKDAYS.map((day) => {
    const chip = document.createElement('label');
    chip.className = 'weekday';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = String(day.value);
    box.checked = selected.includes(day.value);

    const caption = document.createElement('span');
    caption.textContent = day.short;

    chip.append(box, caption);
    return chip;
  }));
}

function readWeekdayChips(container) {
  return [...container.querySelectorAll('input:checked')].map((box) => Number(box.value));
}

// Из пары «селект + чипсы» получаем правило либо null
function readRepeat(select, chips) {
  if (select.value === '') {
    return null;
  }

  if (select.value !== 'custom') {
    return { type: select.value };
  }

  const days = readWeekdayChips(chips);
  return days.length === 0 ? null : { type: 'custom', days };
}

function syncRepeatDays(select, chips) {
  chips.hidden = select.value !== 'custom';
}

/* Проекты */

function selectProject(id) {
  selectedProject = id;
  saveStored(PROJECT_KEY, id);
  renderProjects();
  renderProjectOptions();
  render();
}

function createProjectElement(id, name, removable) {
  const item = document.createElement('li');
  item.className = 'project';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'project-name';
  button.dataset.id = id;

  if (removable) {
    const dot = document.createElement('span');
    dot.className = 'project-color';
    dot.dataset.color = projectColor(id);
    button.append(dot);
  }

  button.append(name);

  if (id === selectedProject) {
    item.classList.add('project-active');
    button.setAttribute('aria-current', 'true');
  }

  item.append(button);

  if (removable) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'project-delete';
    remove.dataset.id = id;
    remove.textContent = '\u00d7';
    remove.setAttribute('aria-label', `Удалить проект «${name}»`);
    item.append(remove);
  }

  return item;
}

// Список проектов прокручивается: вертикально в дневном режиме,
// горизонтально в недельном. Края подтушёвываются, а стрелки
// показываются только с той стороны, куда ещё есть что листать.
function updateProjectsScroll() {
  const horizontal = viewMode === 'week';

  const size = horizontal ? projectsList.clientWidth : projectsList.clientHeight;
  const total = horizontal ? projectsList.scrollWidth : projectsList.scrollHeight;
  const position = horizontal ? projectsList.scrollLeft : projectsList.scrollTop;

  const scrollable = total > size + 1;
  const atStart = position <= 1;
  const atEnd = position + size >= total - 1;

  projectsList.classList.toggle('fade-start', scrollable && !atStart);
  projectsList.classList.toggle('fade-end', scrollable && !atEnd);

  projectsArrowStart.hidden = !scrollable || atStart;
  projectsArrowEnd.hidden = !scrollable || atEnd;

  projectsArrowStart.textContent = horizontal ? '\u25c0' : '\u25b2';
  projectsArrowEnd.textContent = horizontal ? '\u25b6' : '\u25bc';
}

function scrollProjects(direction) {
  const horizontal = viewMode === 'week';
  const step = (horizontal ? projectsList.clientWidth : projectsList.clientHeight) * 0.7;

  projectsList.scrollBy({
    [horizontal ? 'left' : 'top']: step * direction,
    behavior: 'smooth',
  });
}

function renderProjects() {
  projectsList.replaceChildren(
    createProjectElement(ALL_PROJECTS, 'Все проекты', false),
    ...projects.map((project) => createProjectElement(String(project.id), project.name, true)),
  );

  updateProjectsScroll();
}

// Селекты в форме создания и в форме правки заполняются одинаково
function fillProjectOptions(select, value) {
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'Без проекта';

  select.replaceChildren(none, ...projects.map((project) => {
    const option = document.createElement('option');
    option.value = String(project.id);
    option.textContent = project.name;
    return option;
  }));

  select.value = value ?? '';
}

function renderProjectOptions() {
  // В форме создания подставляем открытый проект — так чаще всего и нужно
  const preset = selectedProject === ALL_PROJECTS ? '' : selectedProject;
  fillProjectOptions(projectSelect, projectSelect.value || preset);
}

/* Дедлайны */

// Дату из <input type="date"> разбираем по частям: new Date('2026-09-25')
// разобрал бы её как полночь UTC и в нашем часовом поясе сдвинул бы день.
function parseDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function daysUntil(deadline) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // round, а не floor: в сутки перехода на зимнее время 25 часов
  return Math.round((parseDate(deadline) - today) / 86400000);
}

function formatDeadline(value) {
  return parseDate(value).toLocaleDateString('ru-RU');
}

function deadlineStatus(deadline) {
  const days = daysUntil(deadline);

  if (days < 0) {
    return { name: 'overdue', title: 'Просрочено' };
  }

  if (days === 0) {
    return { name: 'today', title: 'Последний день' };
  }

  if (days <= 2) {
    return { name: 'soon', title: `${days === 1 ? 'Остался' : 'Осталось'} ${days} ${pluralDays(days)}` };
  }

  return { name: 'later', title: `Осталось ${days} ${pluralDays(days)}` };
}

// forms: [1 день, 2 дня, 5 дней]
function plural(count, forms) {
  const tail = count % 10;
  const hundred = count % 100;

  if (tail === 1 && hundred !== 11) {
    return forms[0];
  }

  if (tail >= 2 && tail <= 4 && (hundred < 12 || hundred > 14)) {
    return forms[1];
  }

  return forms[2];
}

function pluralDays(count) {
  return plural(count, ['день', 'дня', 'дней']);
}

function pluralTasks(count) {
  return plural(count, ['задача', 'задачи', 'задач']);
}

/* Отрисовка */

// iso нужен для недельного вида: там в каждой колонке свой день,
// и выполненность повторяющейся задачи считается именно по нему
// ВАЖНО: вызывать только с явной датой — .map(createTaskElement) передаст
// вторым аргументом индекс, и выполненность повторяющейся задачи посчитается
// по числу вместо даты
function createTaskElement(task, iso = selectedDate) {
  if (typeof iso !== 'string') {
    throw new TypeError(`createTaskElement: ожидалась дата, получено ${typeof iso}`);
  }

  const done = isCompletedOn(task, iso);

  const item = document.createElement('li');
  item.className = done ? 'task done' : 'task';
  item.dataset.id = task.id;
  item.dataset.date = iso;

  // Перетаскивать можно только за ручку: иначе жест конфликтовал бы
  // с кликом по названию, который открывает окно правки
  const handle = document.createElement('span');
  handle.className = 'task-handle';
  handle.textContent = '\u22ee\u22ee';
  handle.title = 'Перетащить';
  handle.addEventListener('mousedown', () => {
    item.draggable = true;
  });

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'task-check';
  checkbox.checked = done;
  checkbox.id = `task-${task.id}-${iso}`;

  // Раньше это был <label for>, и клик по тексту переключал галочку.
  // Теперь клик открывает правку, поэтому имя чекбоксу даём через aria-label.
  checkbox.setAttribute('aria-label', task.text);

  const label = document.createElement('button');
  label.type = 'button';
  label.className = 'task-text';
  label.textContent = task.text;
  label.setAttribute('aria-label', `Редактировать задачу «${task.text}»`);

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'task-delete';
  removeButton.textContent = '×';
  removeButton.setAttribute('aria-label', `Удалить задачу «${task.text}»`);

  // Только метка: срок правится через форму по клику на задачу
  const dot = document.createElement('span');
  dot.className = 'deadline-dot';

  if (task.deadline) {
    const status = deadlineStatus(task.deadline);

    dot.classList.add(status.name);

    // Свой всплывающий текст вместо title: нативный ждёт около секунды
    dot.dataset.hint = `${status.title} · ${formatDeadline(task.deadline)}`;
    dot.setAttribute('aria-label', dot.dataset.hint);
  }

  const extras = [];

  if (task.repeat) {
    const mark = document.createElement('span');
    mark.className = 'repeat-mark';
    mark.textContent = '\u21bb';
    mark.title = repeatTitle(task);
    mark.setAttribute('aria-label', repeatTitle(task));
    extras.push(mark);
  }

  const badge = projectName(task.projectId);

  if (badge !== null) {
    const tag = document.createElement('span');
    tag.className = 'project-tag';
    tag.dataset.color = projectColor(task.projectId);
    tag.textContent = badge;
    extras.push(tag);
  }

  item.append(handle, checkbox, label, ...extras, dot, removeButton);
  return item;
}

function render() {
  if (viewMode === 'week') {
    renderWeek();
    return;
  }

  renderDay();
}

function renderDay() {
  const forDay = tasksForDate(selectedDate);
  const active = forDay.filter((task) => !isCompletedOn(task, selectedDate));
  const done = forDay.filter((task) => isCompletedOn(task, selectedDate));

  tasksTitle.textContent = titleForDate(selectedDate);

  if (active.length === 0) {
    const message = done.length === 0 ? 'На этот день задач нет' : 'Все задачи выполнены';
    list.replaceChildren(createEmptyElement(message));
    counter.textContent = '';
  } else {
    list.replaceChildren(...active.map((task) => createTaskElement(task, selectedDate)));
    counter.textContent = `${active.length} ${pluralTasks(active.length)}`;
  }

  doneList.replaceChildren(
    ...(done.length === 0
      ? [createEmptyElement('Здесь пока пусто')]
      : done.map((task) => createTaskElement(task, selectedDate))),
  );
  doneCounter.textContent = done.length;

  // toggle у <details> прилетает асинхронно, поэтому перед перерисовкой
  // сверяемся с реальным состоянием: вдруг событие ещё не успело дойти.
  // У скрытой секции open доверия нет — её состояние помнит только doneOpen.
  if (!doneSection.hidden) {
    doneOpen = doneSection.open;
  }

  // Раскрытую секцию не прячем, даже когда из неё вынули всё:
  // свернуть её может только человек. Скрываем лишь свёрнутую и пустую.
  doneSection.hidden = done.length === 0 && !doneOpen;
  doneSection.open = doneOpen;
}

function focusCheckbox(id) {
  const item = [...list.children, ...doneList.children].find((element) => element.dataset.id === id);

  if (!item) {
    return;
  }

  // Задача могла уехать в свёрнутую секцию — там фокусировать нечего,
  // поэтому ставим фокус на её заголовок: видно, куда она делась
  if (doneSection.contains(item) && !doneSection.open) {
    doneSection.querySelector('summary').focus();
    return;
  }

  item.querySelector('.task-check').focus();
}

function createEmptyElement(message) {
  const item = document.createElement('li');
  item.className = 'tasks-empty';
  item.textContent = message;
  return item;
}

function showError(error) {
  errorBox.textContent = typeof error === 'string'
    ? error
    : `Не удалось связаться с сервером: ${error.message}. Запущен ли json-server?`;
  errorBox.hidden = false;
}

function hideError() {
  errorBox.hidden = true;
}

/* События */

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const text = input.value.trim();
  if (text === '') {
    input.focus();
    return;
  }

  const deadline = deadlineInput.value || null;
  const date = plannedInput.value || selectedDate;
  const repeat = readRepeat(repeatSelect, repeatDays);

  input.value = '';
  deadlineInput.value = '';
  plannedInput.value = selectedDate;

  // Повтор сбрасываем: незамеченное правило наплодило бы задачу во всех днях.
  // Проект, наоборот, оставляем — подряд обычно добавляют в один и тот же.
  const previousRepeat = repeatSelect.value;
  repeatSelect.value = '';
  buildWeekdayChips(repeatDays, []);
  syncRepeatDays(repeatSelect, repeatDays);

  try {
    hideError();
    revealTask(await addTask(text, deadline, date, projectSelect.value || null, repeat));
  } catch (error) {
    input.value = text;
    deadlineInput.value = deadline ?? '';
    plannedInput.value = date;
    repeatSelect.value = previousRepeat;
    buildWeekdayChips(repeatDays, repeat?.days ?? []);
    syncRepeatDays(repeatSelect, repeatDays);
    showError(error);
  }

  input.focus();
});

main.addEventListener('change', async (event) => {
  const checkbox = event.target;

  // Строго по классу: в форме правки внутри .task лежат ещё и чекбоксы
  // дней недели, и раньше клик по дню отмечал задачу выполненной
  if (!checkbox.classList.contains('task-check')) {
    return;
  }

  const item = checkbox.closest('.task');

  if (item === null) {
    return;
  }

  const id = item.dataset.id;

  try {
    hideError();
    await toggleTask(id, checkbox.checked, item.dataset.date ?? selectedDate);
    focusCheckbox(id);
  } catch (error) {
    checkbox.checked = !checkbox.checked;
    showError(error);
  }
});

main.addEventListener('click', async (event) => {
  const button = event.target.closest('.task-delete');
  if (button === null) {
    return;
  }

  const row = button.closest('.task');
  const id = row.dataset.id;
  const task = tasks.find((item) => String(item.id) === id);

  let scope = 'all';

  if (task?.repeat) {
    scope = await ask(`«${task.text}» повторяется: ${repeatSummary(task)}. Что удалить?`, [
      { value: 'one', label: 'Только этот день' },
      { value: 'all', label: 'Все повторения', kind: 'danger' },
      { value: null, label: 'Отмена' },
    ]);

    if (scope === null) {
      return;
    }
  }

  try {
    hideError();

    if (scope === 'one') {
      await skipOccurrence(task, row.dataset.date);
    } else {
      await deleteTask(id);
    }
  } catch (error) {
    showError(error);
  }
});

/* Правка задачи */

main.addEventListener('click', (event) => {
  const opener = event.target.closest('.task-text');
  if (opener) {
    const row = opener.closest('.task');
    openEditor(row.dataset.id, row.dataset.date);
    return;
  }

  if (event.target.closest('.task-edit-cancel')) {
    closeEditor();
    return;
  }

  // Клик мимо формы — по подложке диалога — тоже закрывает
  if (event.target === editor) {
    closeEditor();
  }
});

main.addEventListener('submit', async (event) => {
  const form = event.target.closest('.task-edit');
  if (form === null) {
    return;
  }

  event.preventDefault();

  const field = form.querySelector('.task-edit-text');
  const text = field.value.trim();

  if (text === '') {
    field.focus();
    return;
  }

  const id = form.dataset.id;
  const task = tasks.find((item) => String(item.id) === id);

  const fields = {
    text,
    date: form.querySelector('.task-edit-planned').value || todayISO(),
    deadline: form.querySelector('.task-edit-deadline').value || null,
    projectId: form.querySelector('.task-edit-project').value || null,
    repeat: readRepeat(form.querySelector('.task-edit-repeat'), form.querySelector('.task-edit-days')),
  };

  let scope = 'all';

  // Спрашиваем только у той задачи, которая повторялась до правки:
  // если правило сняли, менять нечего, кроме неё самой
  if (task?.repeat) {
    scope = await ask(`«${task.text}» повторяется: ${repeatSummary(task)}. К чему применить изменения?`, [
      { value: 'one', label: 'Только этот день' },
      { value: 'all', label: 'Ко всем повторениям' },
      { value: null, label: 'Отмена' },
    ]);

    if (scope === null) {
      return;
    }
  }

  try {
    hideError();

    if (scope === 'one') {
      await detachOccurrence(task, form.dataset.date, fields);
    } else {
      await editTask(id, fields);
    }

    closeEditor();
  } catch (error) {
    showError(error);
  }
});

/* Проекты: выбор, создание, удаление */

main.addEventListener('click', async (event) => {
  const chosen = event.target.closest('.project-name');
  if (chosen) {
    selectProject(chosen.dataset.id);
    return;
  }

  const remove = event.target.closest('.project-delete');
  if (remove) {
    const id = remove.dataset.id;
    const name = projectName(id);
    const count = tasks.filter((task) => String(task.projectId) === id).length;
    const tail = count === 0
      ? ''
      : ` ${count} ${plural(count, ['задача останется', 'задачи останутся', 'задач останутся'])} без проекта.`;

    if (!confirm(`Удалить проект «${name}»?${tail}`)) {
      return;
    }

    try {
      hideError();
      await deleteProject(id);
    } catch (error) {
      showProjectError(error);
    }
    return;
  }

  if (event.target.closest('.project-add')) {
    openProjectInput();
  }
});

// Поле для имени нового проекта появляется прямо в списке, вместе с палитрой
function openProjectInput() {
  if (projectsList.querySelector('.project-new')) {
    projectsList.querySelector('.project-new').focus();
    return;
  }

  // Цвет по умолчанию берём по счётчику, чтобы новые проекты не совпадали
  let chosen = PROJECT_COLORS[projects.length % PROJECT_COLORS.length];

  const item = document.createElement('li');
  item.className = 'project project-draft';

  const field = document.createElement('input');
  field.type = 'text';
  field.className = 'project-new';
  field.placeholder = 'Название';
  field.setAttribute('aria-label', 'Название нового проекта');

  const palette = document.createElement('div');
  palette.className = 'palette';

  const swatches = PROJECT_COLORS.map((color) => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'swatch';
    swatch.dataset.color = color;
    swatch.setAttribute('aria-label', `Цвет: ${color}`);
    swatch.setAttribute('aria-pressed', String(color === chosen));
    swatch.classList.toggle('swatch-chosen', color === chosen);

    // Не даём полю потерять фокус: иначе строка закроется по focusout
    swatch.addEventListener('mousedown', (event) => event.preventDefault());

    swatch.addEventListener('click', () => {
      chosen = color;

      for (const other of swatches) {
        const active = other.dataset.color === chosen;
        other.classList.toggle('swatch-chosen', active);
        other.setAttribute('aria-pressed', String(active));
      }
    });

    return swatch;
  });

  palette.append(...swatches);
  item.append(field, palette);
  projectsList.append(item);
  updateProjectsScroll();
  field.focus();

  const close = () => {
    item.remove();
    updateProjectsScroll();
  };

  field.addEventListener('keydown', async (event) => {
    if (event.key === 'Escape') {
      close();
      return;
    }

    if (event.key !== 'Enter') {
      return;
    }

    const name = field.value.trim();
    if (name === '') {
      return;
    }

    try {
      hideError();
      await addProject(name, chosen);
    } catch (error) {
      showProjectError(error);
    }
  });

  // focusout вместо blur: уход фокуса внутрь строки закрывать её не должен
  item.addEventListener('focusout', (event) => {
    if (!item.contains(event.relatedTarget)) {
      close();
    }
  });
}

/* Перетаскивание задач внутри дня */

// Список, внутри которого идёт перетаскивание. Между колонками недели
// не переносим: это означало бы смену дня, а для повторяющихся задач
// такой перенос вообще не имеет смысла.
let draggingList = null;

// Строка, перед которой встанет перетаскиваемая: первая, чья середина ниже курсора
function dropTargetAt(container, y) {
  return [...container.querySelectorAll('.task:not(.dragging)')].find((item) => {
    const box = item.getBoundingClientRect();
    return y < box.top + box.height / 2;
  }) ?? null;
}

main.addEventListener('dragstart', (event) => {
  const item = event.target.closest('.task');

  if (item === null) {
    return;
  }

  draggingList = item.parentElement;
  item.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
});

// Пока идёт перетаскивание, сброс принимаем где угодно. Иначе браузер
// считает его несостоявшимся и проигрывает анимацию возврата: строка
// прыгает на старое место и только потом встаёт на новое.
function acceptDrag(event) {
  if (draggingList === null) {
    return false;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  return true;
}

main.addEventListener('dragenter', acceptDrag);

main.addEventListener('dragover', (event) => {
  if (!acceptDrag(event)) {
    return;
  }

  const dragged = draggingList.querySelector('.dragging');

  // Двигаем строку, только когда курсор над своим списком: между
  // колонками недели не переносим
  if (dragged === null || event.target.closest('.tasks') !== draggingList) {
    return;
  }

  const target = dropTargetAt(draggingList, event.clientY);

  if (target === null) {
    draggingList.append(dragged);
  } else if (target !== dragged.nextSibling) {
    draggingList.insertBefore(dragged, target);
  }
});

main.addEventListener('drop', (event) => {
  if (draggingList !== null) {
    event.preventDefault();
  }
});

main.addEventListener('dragend', async (event) => {
  const item = event.target.closest('.task');

  if (item === null || draggingList === null) {
    return;
  }

  const container = draggingList;
  draggingList = null;

  item.classList.remove('dragging');
  item.draggable = false;

  await saveOrder([...container.querySelectorAll('.task')].map((row) => row.dataset.id));
});

/* Прокрутка списка проектов */

projectsList.addEventListener('scroll', updateProjectsScroll, { passive: true });
window.addEventListener('resize', updateProjectsScroll);

main.addEventListener('click', (event) => {
  if (event.target.closest('.projects-arrow-start')) {
    scrollProjects(-1);
    return;
  }

  if (event.target.closest('.projects-arrow-end')) {
    scrollProjects(1);
  }
});

/* Режимы и недели */

main.addEventListener('click', (event) => {
  const mode = event.target.closest('.mode');
  if (mode) {
    setMode(mode.dataset.mode);
    return;
  }

  const step = event.target.closest('.week-step');
  if (step) {
    selectDate(shiftISO(selectedDate, Number(step.dataset.step)));
    return;
  }

  if (event.target.closest('.weeks-today')) {
    selectDate(todayISO());
    return;
  }

  const item = event.target.closest('.week-item');
  if (item === null) {
    return;
  }

  // По текущей неделе — календарь, по размытым соседям — переход на них
  if (item.classList.contains('week-item-current')) {
    openDayPicker(item);
  } else {
    selectDate(item.dataset.date);
  }
});

// Колёсико над неделей намеренно не перехватываем: вертикальный жест
// должен листать страницу, а колонки двигаются горизонтальным жестом.

/* Переключение дней */

main.addEventListener('click', (event) => {
  const step = event.target.closest('.days-step');
  if (step) {
    selectDate(shiftISO(selectedDate, Number(step.dataset.step)));
    return;
  }

  if (event.target.closest('.days-today')) {
    selectDate(todayISO());
    return;
  }

  const day = event.target.closest('.day');
  if (day === null) {
    return;
  }

  // По текущему дню — календарь, по размытым соседям — переход на них
  if (day.classList.contains('day-current')) {
    openDayPicker(day);
  } else {
    selectDate(day.dataset.date);
  }
});

// Крутилка над полосой дней. passive: false — иначе preventDefault не сработает
// и страница поедет вместе с календарём. Пауза, чтобы один жест не пролистал неделю.
dayPicker.addEventListener('change', () => {
  if (dayPicker.value) {
    selectDate(dayPicker.value);
  }
});

let wheelAt = 0;

strip.addEventListener('wheel', (event) => {
  if (viewMode === 'week') {
    return;
  }

  event.preventDefault();

  if (Math.abs(event.deltaY) < 2 || Date.now() - wheelAt < 150) {
    return;
  }

  wheelAt = Date.now();
  selectDate(shiftISO(selectedDate, event.deltaY > 0 ? 1 : -1));
}, { passive: false });

window.addEventListener('pagehide', saveScroll);

applyMode();
buildWeekdayChips(repeatDays, []);
repeatSelect.addEventListener('change', () => syncRepeatDays(repeatSelect, repeatDays));

plannedInput.value = selectedDate;
renderDays();
renderProjects();

async function start() {
  await loadProjects();

  try {
    await loadTasks();
  } catch (error) {
    showError(error);
  }

  // Только теперь страница набрала высоту и прокрутку есть куда вернуть
  restoreScroll();
}

start();
