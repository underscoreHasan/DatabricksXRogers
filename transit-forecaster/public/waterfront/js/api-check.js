import { ENDPOINTS, runChecks } from './api-check-api.js';
import { minimumDate } from './data.js';

const get = id => document.getElementById(id);
const form = get('check-form');
const dateInput = get('check-date');
const runButton = get('run');
const downloadButton = get('download');
const status = get('status');
const cards = new Map();
let report = null;
dateInput.value = minimumDate();

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function resetResults(date) {
  get('results').replaceChildren();
  get('weather-rows').replaceChildren();
  get('weather-section').hidden = true;
  cards.clear();
  for (const endpoint of ENDPOINTS) {
    const card = element('article');
    const header = element('header');
    const badge = element('span', 'Loading…', 'badge');
    header.append(element('h2', endpoint.label), badge);
    const link = element('a', endpoint.path);
    link.href = endpoint.path + (endpoint.id === 'health' ? '' : `?date=${encodeURIComponent(date)}`);
    link.target = '_blank';
    link.rel = 'noopener';
    const summary = element('p', 'Waiting for response…', 'summary');
    const timing = element('p', endpoint.source, 'muted');
    const details = element('details');
    const raw = element('pre', '');
    details.append(element('summary', 'Response JSON'), raw);
    details.hidden = true;
    card.append(header, timing, link, summary, details);
    get('results').append(card);
    cards.set(endpoint.id, { card, badge, summary, timing, details, raw });
  }
}

const flag = value => value === true ? 'Yes' : value === false ? 'No' : 'Unknown';
function describe(result) {
  if (result.error) return result.error;
  const data = result.data;
  switch (result.id) {
    case 'dayOfWeek': return `${data.dayOfWeek} · ${data.dayOfWeekNumber} (Monday = 1)`;
    case 'holiday': return `B.C. statutory holiday: ${flag(data.isHoliday)}`;
    case 'health': return data.message || 'Backend is running.';
    case 'weather': return `${data.n_slots} half-hour rows · ${data.mode === 'forecast' ? 'Weather forecast' : 'Historical average'}${data.years_used?.length ? ` (${data.years_used.join(', ')})` : ''}\nAll readings are in the table below.`;
    case 'events': return [
      `Lookup: ${data.lookupStatus}. High attendance: ${flag(data.hasHighAttendanceEvent)}.`,
      data.lookupStatus === 'partial' ? 'Incomplete coverage; a missing event does not mean none exist.' : '',
      data.event ? `${data.event.name} · ${data.event.size}\nStart: ${data.event.startTime}\nEnd: ${data.event.endTime}${data.event.endTimeEstimated ? ' (estimated)' : ''}`
        : data.lookupStatus === 'ok' ? 'No qualifying event returned.' : 'No verified event returned.',
    ].filter(Boolean).join('\n');
  }
}

function render(result) {
  const refs = cards.get(result.id);
  refs.card.dataset.state = result.state;
  refs.badge.textContent = { ok: 'OK', partial: 'Partial', error: 'Failed' }[result.state];
  refs.summary.textContent = describe(result);
  refs.timing.textContent = `${result.source} · ${result.status === null ? 'No HTTP response' : `HTTP ${result.status}`} · ${result.elapsedMs} ms`;
  refs.details.hidden = result.data === null;
  refs.raw.textContent = JSON.stringify(result.data, null, 2);
  if (result.id === 'weather' && result.state === 'ok') {
    const data = result.data;
    get('weather-section').hidden = false;
    get('weather-meta').textContent = `${data.date} · ${data.timezone} · ${data.mode}${data.years_used?.length ? ` · Years: ${data.years_used.join(', ')}` : ''}`;
    for (const row of data.weather) {
      const tr = element('tr');
      for (const value of [row.time_local, row.time, flag(row.rain), row.temp_c, row.precip_mm, row.rain_mm]) {
        tr.append(element('td', String(value)));
      }
      get('weather-rows').append(tr);
    }
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const date = dateInput.value;
  report = null;
  downloadButton.disabled = true;
  runButton.disabled = true;
  dateInput.disabled = true;
  resetResults(date);
  status.textContent = `Testing ${date}…`;
  let finished = 0;
  try {
    const results = await runChecks(date, { onResult: result => {
      render(result);
      status.textContent = `Testing ${date} · ${++finished}/${ENDPOINTS.length} complete…`;
    } });
    report = { date, checkedAt: new Date().toISOString(), results };
    const count = state => results.filter(result => result.state === state).length;
    status.textContent = `${date} · ${count('ok')} OK, ${count('partial')} partial, ${count('error')} failed.`;
    downloadButton.disabled = false;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    runButton.disabled = false;
    dateInput.disabled = false;
  }
});

downloadButton.addEventListener('click', () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = element('a');
  link.href = url;
  link.download = `forecast-inputs-${report.date}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
