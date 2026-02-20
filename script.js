/**
 * Home Brew Tracker
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

function parseFermenting(val) {
  if (val === false || val === 'false' || val === '0' || val === 0) return false;
  return true; // default true for backward compat (missing column = fermenting)
}

function normalizeRow(row) {
  const id = row.id ?? row[0] ?? '';
  const name = row.name ?? row[1] ?? '';
  const readingsRaw = row.readings ?? row[2];
  const notes = row.notes ?? row[3] ?? '';
  const ingredientsRaw = row.ingredients ?? row[4];
  const fermentingRaw = row.fermenting ?? row[5];
  return {
    id: String(id).trim(),
    name: String(name).trim(),
    readings: parseJsonColumn(readingsRaw),
    notes: String(notes ?? '').trim(),
    ingredients: parseJsonColumn(ingredientsRaw),
    fermenting: parseFermenting(fermentingRaw),
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
    errEl.textContent = e.message || 'Could not load brews.';
    errEl.classList.remove('hidden');
    return brews;
  }
}

function getBrewById(id) {
  return brews.find((b) => b.id === id) || null;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return dateStr;
  
  // Try ISO format first (from date input: YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(dateStr);
  }
  
  // Try DD/MM/YY or DD/MM/YYYY
  const parts = dateStr.split('/');
  if (parts.length >= 2) {
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    let year = parts[2] ? parseInt(parts[2], 10) : new Date().getFullYear();
    if (year < 100) year += 2000;
    return new Date(year, month, day);
  }
  
  return new Date(dateStr);
}

function formatDate(date) {
  if (!date || isNaN(date.getTime())) return '—';
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

function formatDateShort(date) {
  if (!date || isNaN(date.getTime())) return '—';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

function getBrewStats(brew) {
  const readings = brew.readings || [];
  const stats = {
    og: null,
    current: null,
    abv: null,
    days: null,
    count: readings.length,
    startDate: null,
    status: 'NEW',
  };

  if (readings.length === 0) return stats;

  const firstReading = readings[0];
  const lastReading = readings[readings.length - 1];

  stats.og = firstReading.SG != null ? Number(firstReading.SG) : null;
  stats.current = lastReading.SG != null ? Number(lastReading.SG) : null;
  stats.startDate = parseDate(firstReading.date);

  // Calculate ABV: (OG - FG) * 131.25 / 1000 (for SG in format like 1046)
  if (stats.og != null && stats.current != null) {
    const ogNorm = stats.og > 100 ? stats.og / 1000 : stats.og;
    const fgNorm = stats.current > 100 ? stats.current / 1000 : stats.current;
    stats.abv = ((ogNorm - fgNorm) * 131.25).toFixed(1);
  }

  // Calculate days fermenting
  if (stats.startDate && !isNaN(stats.startDate.getTime())) {
    const now = new Date();
    const diffMs = now - stats.startDate;
    stats.days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  // User can mark complete; otherwise infer from SG trend
  if (brew.fermenting === false) {
    stats.status = 'COMPLETE';
  } else if (readings.length >= 2) {
    const recentReadings = readings.slice(-3);
    const sgValues = recentReadings.map(r => Number(r.SG)).filter(v => !isNaN(v));
    if (sgValues.length >= 2) {
      const diff = sgValues[sgValues.length - 1] - sgValues[0];
      if (Math.abs(diff) <= 2) {
        stats.status = 'READY';
      } else {
        stats.status = 'FERMENTING';
      }
    } else {
      stats.status = 'FERMENTING';
    }
  } else if (readings.length === 1) {
    stats.status = 'FERMENTING';
  }

  return stats;
}

function formatSG(sg) {
  if (sg == null) return '—';
  const num = Number(sg);
  if (isNaN(num)) return '—';
  if (num > 100) {
    return (num / 1000).toFixed(3);
  }
  return num.toFixed(3);
}

function getFirstDate(brew) {
  if (brew.readings && brew.readings.length) {
    const d = parseDate(brew.readings[0].date);
    return formatDate(d);
  }
  return 'No readings';
}

function renderList(brewsToRender) {
  const container = $('#card-list');
  container.innerHTML = '';
  
  if (brewsToRender.length === 0) {
    container.innerHTML = '<p class="empty-state">No brews yet. Start your first brew!</p>';
    return;
  }

  brewsToRender.forEach((brew) => {
    const stats = getBrewStats(brew);
    const card = document.createElement('article');
    card.className = 'brew-card';
    card.dataset.id = brew.id;
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    
    const statusClass = stats.status.toLowerCase();
    card.innerHTML = `
      <h4>${escapeHtml(brew.name)} <span class="brew-status ${statusClass}">${stats.status}</span></h4>
      <p class="brew-date">${getFirstDate(brew)}</p>
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
  
  if (!readings || readings.length === 0) {
    return;
  }

  const labels = readings.map((r) => {
    const d = parseDate(r.date);
    return formatDateShort(d);
  });
  
  const data = readings.map((r) => {
    if (r.SG == null) return null;
    const sg = Number(r.SG);
    return sg > 100 ? sg / 1000 : sg;
  });

  sgChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'SG',
          data,
          borderColor: '#e8a030',
          backgroundColor: 'rgba(232, 160, 48, 0.1)',
          tension: 0.3,
          fill: true,
          pointRadius: 4,
          pointBackgroundColor: '#e8a030',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        y: {
          beginAtZero: false,
          ticks: {
            callback: (val) => val.toFixed(3),
          },
        },
        x: {
          grid: { display: false },
        },
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
  const stats = getBrewStats(brew);

  // Header
  $('#detail-name').textContent = brew.name;
  $('#status-badge').textContent = stats.status;
  $('#status-badge').className = `status-badge ${stats.status.toLowerCase()}`;

  // Meta info
  $('#start-date').innerHTML = stats.startDate ? `📅 ${formatDate(stats.startDate)}` : '';
  $('#og-display').innerHTML = stats.og != null ? `⚗ OG: ${formatSG(stats.og)}` : '';
  $('#current-sg-display').innerHTML = stats.current != null ? `📉 Current: ${formatSG(stats.current)}` : '';

  // Stats cards
  $('#stat-current-sg').textContent = formatSG(stats.current);
  $('#stat-abv').textContent = stats.abv != null ? `${stats.abv}%` : '—';
  $('#stat-days').textContent = stats.days != null ? stats.days : '—';
  $('#stat-readings').textContent = stats.count;

  // Mark complete / Mark fermenting button
  const markCompleteBtn = $('#mark-complete-btn');
  if (brew.fermenting === false) {
    markCompleteBtn.textContent = 'Mark as fermenting';
    markCompleteBtn.className = 'secondary';
  } else {
    markCompleteBtn.textContent = 'Mark as complete';
    markCompleteBtn.className = 'secondary';
  }
  markCompleteBtn.onclick = () => {
    brew.fermenting = !brew.fermenting;
    postBrew(brew).then(() => showDetail(brew.id));
  };

  // Chart
  destroySgChart();
  renderSgChart(brew.readings);

  // Add Reading button & dialog
  const dialog = $('#reading-dialog');
  $('#add-reading-btn').onclick = () => {
    $('#reading-date').valueAsDate = new Date();
    $('#reading-sg').value = '';
    $('#reading-temp').value = '';
    dialog.showModal();
  };
  $('#close-reading-dialog').onclick = () => dialog.close();
  dialog.onclick = (e) => {
    if (e.target === dialog) dialog.close();
  };

  // Log Reading form
  const logForm = $('#log-reading-form');
  logForm.onsubmit = (e) => {
    e.preventDefault();
    const dateInput = $('#reading-date');
    const sgInput = $('#reading-sg');
    const tempInput = $('#reading-temp');
    
    const dateVal = dateInput.value;
    const SG = parseFloat(sgInput.value);
    const temp = tempInput.value !== '' ? parseFloat(tempInput.value) : null;
    
    if (!dateVal || isNaN(SG)) return;
    
    brew.readings = brew.readings || [];
    brew.readings.push({ date: dateVal, SG, temp });
    
    dialog.close();
    postBrew(brew).then(() => {
      showDetail(brew.id);
    });
  };

  // Comments
  const commentsDisplay = $('#comments-display');
  const commentsEdit = $('#comments-edit');
  const commentsTextarea = $('#comments-textarea');
  const commentsEditBtn = $('#comments-edit-btn');
  const commentsSave = $('#comments-save');
  const commentsCancel = $('#comments-cancel');

  commentsDisplay.textContent = brew.notes || 'No notes yet.';
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
    commentsDisplay.textContent = newNotes || 'No notes yet.';
    commentsEdit.classList.add('hidden');
    commentsEditBtn.classList.remove('hidden');
    commentsDisplay.classList.remove('hidden');
    postBrew(brew);
  };

  // Ingredients
  const ingredientsList = $('#ingredients-list');
  const ingredientsTotal = $('#ingredients-total');
  
  function renderIngredients() {
    ingredientsList.innerHTML = '';
    let total = 0;
    
    (brew.ingredients || []).forEach((ing, idx) => {
      const li = document.createElement('li');
      li.dataset.index = String(idx);
      const item = ing.item ?? '';
      const cost = ing.cost != null ? parseFloat(ing.cost) : 0;
      total += cost;
      
      li.innerHTML = `
        <span class="ingredient-text">${escapeHtml(String(item))}</span>
        <span class="ingredient-cost">$${cost.toFixed(2)}</span>
        <span class="ingredient-actions">
          <button type="button" class="ingredient-edit-btn secondary small" data-index="${idx}">Edit</button>
          <button type="button" class="ingredient-delete-btn secondary small" data-index="${idx}">×</button>
        </span>
      `;
      li.querySelector('.ingredient-edit-btn').onclick = () => editIngredient(brew, idx);
      li.querySelector('.ingredient-delete-btn').onclick = () => deleteIngredient(brew, idx);
      ingredientsList.appendChild(li);
    });
    
    ingredientsTotal.textContent = total.toFixed(2);
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
        <button type="submit" class="small">Save</button>
        <button type="button" class="ing-edit-cancel secondary small">×</button>
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
    fermenting: payload.fermenting !== false,
  };
  try {
    const res = await fetch(GAS_WEB_APP_URL, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error(data.error || `Request failed: ${res.status}`);
    }
    await fetchBrews();
    return data;
  } catch (e) {
    alert(e.message || 'Failed to save.');
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
      fermenting: true,
    };
    try {
      await postBrew(brew);
      renderList(brews);
      $('#start-brew-form').classList.add('hidden');
      nameInput.value = '';
      notesInput.value = '';
    } catch (_) {
      // Error shown in postBrew
    }
  };
}

document.addEventListener('DOMContentLoaded', init);
