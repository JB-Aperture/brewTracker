/**
 * Home Brew Tracker — replace with your published CSV URL and GAS Web App URL.
 */
const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSVe8hHHlMGQDDF7v-Uq9Pocrhkpmfi9OeWlDiOwKGRO9A6JnyNnuP0AStsrGLAn7BMXwjmBMkRXArK/pub?gid=0&single=true&output=csv';
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbykXb0YeMoDNOaoIhpWwQIkeJnJCh8eJGn5LkhLsE6Ee-nkBFqdL1zKzbCbmTCzDYKT/exec';

let brews = [];
let sgChart = null;
let currentBrewId = null;

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => el.querySelectorAll(sel);

function parseJsonColumn(val) {
  if (val == null || val === '') return [];
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeRow(row) {
  const id = row.id ?? row[0] ?? '';
  const name = row.name ?? row[1] ?? '';
  const readingsRaw = row.readings ?? row[2];
  const notes = row.notes ?? row[3] ?? '';
  const ingredientsRaw = row.ingredients ?? row[4];
  return {
    id: String(id).trim(),
    name: String(name).trim(),
    readings: parseJsonColumn(readingsRaw),
    notes: String(notes ?? '').trim(),
    ingredients: parseJsonColumn(ingredientsRaw),
  };
}

async function fetchBrews() {
  const errEl = $('#fetch-error');
  try {
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error(`Failed to load data: ${res.status}`);
    const text = await res.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    const rows = parsed.data && parsed.data.length ? parsed.data : [];
    brews = rows.map(normalizeRow).filter((b) => b.id);
    errEl.classList.add('hidden');
    return brews;
  } catch (e) {
    brews = [];
    errEl.textContent = e.message || 'Could not load brews. Set CSV_URL and publish the sheet as CSV.';
    errEl.classList.remove('hidden');
    return brews;
  }
}

function getBrewById(id) {
  return brews.find((b) => b.id === id) || null;
}

function getFirstDate(brew) {
  if (brew.readings && brew.readings.length) return brew.readings[0].date;
  return 'No readings';
}

function renderList(brewsToRender) {
  const container = $('#card-list');
  container.innerHTML = '';
  brewsToRender.forEach((brew) => {
    const card = document.createElement('article');
    card.className = 'brew-card';
    card.dataset.id = brew.id;
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.innerHTML = `
      <h4>${escapeHtml(brew.name)}</h4>
      <p class="brew-date">${escapeHtml(getFirstDate(brew))}</p>
    `;
    card.addEventListener('click', () => showDetail(brew.id));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showDetail(brew.id);
      }
    });
    container.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showList() {
  const main = $('main');
  main.dataset.view = 'list';
  fetchBrews().then(() => renderList(brews));
}

function destroySgChart() {
  if (sgChart) {
    sgChart.destroy();
    sgChart = null;
  }
}

function renderSgChart(readings) {
  const canvas = $('#sg-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  destroySgChart();
  if (!readings || readings.length === 0) return;
  const labels = readings.map((r) => r.date);
  const data = readings.map((r) => (r.SG != null ? Number(r.SG) : null));
  sgChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'SG',
          data,
          borderColor: 'rgb(75, 192, 192)',
          tension: 0.1,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: false },
      },
    },
  });
}

function showDetail(id) {
  currentBrewId = id;
  const brew = getBrewById(id);
  if (!brew) return;
  const main = $('main');
  main.dataset.view = 'detail';

  $('#detail-name').textContent = brew.name;

  destroySgChart();
  renderSgChart(brew.readings);

  // Comments
  const commentsDisplay = $('#comments-display');
  const commentsEdit = $('#comments-edit');
  const commentsTextarea = $('#comments-textarea');
  const commentsEditBtn = $('#comments-edit-btn');
  const commentsSave = $('#comments-save');
  const commentsCancel = $('#comments-cancel');

  commentsDisplay.textContent = brew.notes || '';
  commentsDisplay.classList.remove('hidden');
  commentsEdit.classList.add('hidden');
  commentsEditBtn.classList.remove('hidden');
  commentsTextarea.value = brew.notes || '';

  commentsEditBtn.onclick = () => {
    commentsDisplay.classList.add('hidden');
    commentsEdit.classList.remove('hidden');
    commentsEditBtn.classList.add('hidden');
    commentsTextarea.value = brew.notes || '';
    commentsTextarea.focus();
  };
  commentsCancel.onclick = () => {
    commentsEdit.classList.add('hidden');
    commentsEditBtn.classList.remove('hidden');
    commentsDisplay.classList.remove('hidden');
  };
  commentsSave.onclick = () => {
    const newNotes = commentsTextarea.value.trim();
    brew.notes = newNotes;
    commentsDisplay.textContent = newNotes || '';
    commentsEdit.classList.add('hidden');
    commentsEditBtn.classList.remove('hidden');
    commentsDisplay.classList.remove('hidden');
    postBrew(brew).then(() => {
      commentsDisplay.textContent = brew.notes || '';
    });
  };

  // Ingredients list
  const ingredientsList = $('#ingredients-list');
  ingredientsList.innerHTML = '';
  function renderIngredients() {
    ingredientsList.innerHTML = '';
    (brew.ingredients || []).forEach((ing, idx) => {
      const li = document.createElement('li');
      li.dataset.index = String(idx);
      const item = ing.item ?? '';
      const cost = ing.cost != null ? ing.cost : '';
      li.innerHTML = `
        <span class="ingredient-text">${escapeHtml(String(item))} — ${escapeHtml(String(cost))}</span>
        <span class="ingredient-actions">
          <button type="button" class="ingredient-edit-btn" data-index="${idx}">Edit</button>
          <button type="button" class="ingredient-delete-btn" data-index="${idx}">Delete</button>
        </span>
      `;
      li.querySelector('.ingredient-edit-btn').onclick = () => editIngredient(brew, idx);
      li.querySelector('.ingredient-delete-btn').onclick = () => deleteIngredient(brew, idx);
      ingredientsList.appendChild(li);
    });
  }
  renderIngredients();

  function editIngredient(brew, idx) {
    const ing = brew.ingredients[idx];
    if (!ing) return;
    const li = ingredientsList.querySelector(`li[data-index="${idx}"]`);
    const itemVal = ing.item ?? '';
    const costVal = ing.cost != null ? ing.cost : '';
    li.innerHTML = `
      <form class="ingredient-edit-form">
        <input type="text" class="ing-edit-item" value="${escapeHtml(String(itemVal))}" placeholder="Item" />
        <input type="number" class="ing-edit-cost" value="${costVal}" placeholder="Cost" min="0" step="0.01" />
        <button type="submit">Save</button>
        <button type="button" class="ing-edit-cancel">Cancel</button>
      </form>
    `;
    const form = li.querySelector('form');
    const itemInput = li.querySelector('.ing-edit-item');
    const costInput = li.querySelector('.ing-edit-cost');
    form.onsubmit = (e) => {
      e.preventDefault();
      brew.ingredients[idx] = { item: itemInput.value.trim(), cost: parseFloat(costInput.value) || 0 };
      postBrew(brew).then(renderIngredients);
    };
    li.querySelector('.ing-edit-cancel').onclick = () => renderIngredients();
  }

  function deleteIngredient(brew, idx) {
    brew.ingredients.splice(idx, 1);
    postBrew(brew).then(renderIngredients);
  }

  // Add ingredient form
  const addForm = $('#add-ingredient-form');
  addForm.onsubmit = (e) => {
    e.preventDefault();
    const itemInput = $('#ingredient-item', addForm);
    const costInput = $('#ingredient-cost', addForm);
    const item = itemInput.value.trim();
    const cost = parseFloat(costInput.value) || 0;
    if (!item) return;
    brew.ingredients = brew.ingredients || [];
    brew.ingredients.push({ item, cost });
    itemInput.value = '';
    costInput.value = '';
    postBrew(brew).then(renderIngredients);
  };

  // Log New Reading form
  const logForm = $('#log-reading-form');
  logForm.onsubmit = (e) => {
    e.preventDefault();
    const dateInput = $('#reading-date', logForm);
    const sgInput = $('#reading-sg', logForm);
    const tempInput = $('#reading-temp', logForm);
    const date = dateInput.value.trim();
    const SG = parseFloat(sgInput.value);
    const temp = tempInput.value !== '' ? parseFloat(tempInput.value) : null;
    if (!date || (SG !== SG && SG !== 0)) return;
    brew.readings = brew.readings || [];
    brew.readings.push({ date, SG, temp });
    dateInput.value = '';
    sgInput.value = '';
    tempInput.value = '';
    postBrew(brew).then(() => {
      destroySgChart();
      renderSgChart(brew.readings);
    });
  };

  // Back button
  $('#back-btn').onclick = () => showList();
}

async function postBrew(payload) {
  const body = {
    id: payload.id,
    name: payload.name,
    readings: Array.isArray(payload.readings) ? payload.readings : [],
    notes: payload.notes ?? '',
    ingredients: Array.isArray(payload.ingredients) ? payload.ingredients : [],
  };
  try {
    const res = await fetch(GAS_WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error(data.error || `Request failed: ${res.status}`);
    }
    await fetchBrews();
    return data;
  } catch (e) {
    alert(e.message || 'Failed to save. Set GAS_WEB_APP_URL and deploy the Apps Script Web App.');
    throw e;
  }
}

function init() {
  fetchBrews().then(() => renderList(brews));

  $('#back-btn').onclick = () => showList();

  $('#new-brew-toggle').onclick = () => {
    $('#start-brew-form').classList.remove('hidden');
  };
  $('#cancel-new-brew').onclick = () => {
    $('#start-brew-form').classList.add('hidden');
  };

  $('#start-brew-form').onsubmit = async (e) => {
    e.preventDefault();
    const nameInput = $('#new-brew-name');
    const notesInput = $('#new-brew-notes');
    const name = nameInput.value.trim();
    if (!name) return;
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now();
    const brew = {
      id,
      name,
      readings: [],
      notes: notesInput.value.trim(),
      ingredients: [],
    };
    try {
      await postBrew(brew);
      renderList(brews);
      $('#start-brew-form').classList.add('hidden');
      nameInput.value = '';
      notesInput.value = '';
    } catch (_) {
      // Error already shown in postBrew
    }
  };
}

document.addEventListener('DOMContentLoaded', init);
