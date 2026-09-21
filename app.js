const API_URL = 'http://localhost:3000/tasks';

const form = document.querySelector('.form');
const input = document.querySelector('#text');
const list = document.querySelector('.tasks');
const counter = document.querySelector('.tasks-counter');
const errorBox = document.querySelector('.error');

let tasks = [];

/* Запросы */

async function request(url, options) {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`Сервер ответил ${response.status}`);
  }

  return response.json();
}

async function loadTasks() {
  tasks = await request(API_URL);
  render();
}

async function addTask(text) {
  const created = await request(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, completed: false }),
  });

  tasks.push(created);
  render();
}

async function toggleTask(id, completed) {
  const updated = await request(`${API_URL}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed }),
  });

  tasks = tasks.map((task) => (String(task.id) === id ? updated : task));
  render();
}

async function deleteTask(id) {
  await request(`${API_URL}/${id}`, { method: 'DELETE' });

  tasks = tasks.filter((task) => String(task.id) !== id);
  render();
}

/* Отрисовка */

function createTaskElement(task) {
  const item = document.createElement('li');
  item.className = task.completed ? 'task done' : 'task';
  item.dataset.id = task.id;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.completed;
  checkbox.id = `task-${task.id}`;

  const label = document.createElement('label');
  label.className = 'task-text';
  label.htmlFor = checkbox.id;
  label.textContent = task.text;

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'task-delete';
  removeButton.textContent = '×';
  removeButton.setAttribute('aria-label', `Удалить задачу «${task.text}»`);

  item.append(checkbox, label, removeButton);
  return item;
}

function render() {
  if (tasks.length === 0) {
    list.replaceChildren(createEmptyElement());
  } else {
    list.replaceChildren(...tasks.map(createTaskElement));
  }

  const done = tasks.filter((task) => task.completed).length;
  counter.textContent = tasks.length === 0 ? '' : `${done} из ${tasks.length} выполнено`;
}

function createEmptyElement() {
  const item = document.createElement('li');
  item.className = 'tasks-empty';
  item.textContent = 'Задач пока нет';
  return item;
}

function showError(error) {
  errorBox.textContent = `Не удалось связаться с сервером: ${error.message}. Запущен ли json-server?`;
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

  input.value = '';

  try {
    hideError();
    await addTask(text);
  } catch (error) {
    input.value = text;
    showError(error);
  }

  input.focus();
});

list.addEventListener('change', async (event) => {
  const checkbox = event.target;
  if (checkbox.type !== 'checkbox') {
    return;
  }

  const id = checkbox.closest('.task').dataset.id;

  try {
    hideError();
    await toggleTask(id, checkbox.checked);
  } catch (error) {
    checkbox.checked = !checkbox.checked;
    showError(error);
  }
});

list.addEventListener('click', async (event) => {
  const button = event.target.closest('.task-delete');
  if (button === null) {
    return;
  }

  const id = button.closest('.task').dataset.id;

  try {
    hideError();
    await deleteTask(id);
  } catch (error) {
    showError(error);
  }
});

loadTasks().catch(showError);
