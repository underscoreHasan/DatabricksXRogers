import { CONFIG } from './config.js';
import { createLatestLoader } from './api.js';
import { minimumDate, isFutureDate, weekday, dayLabel, slotLabel, volumeComparison, contextForSlot, eventWindow } from './data.js';
import { createVisuals } from './visual.js';

const root = document.getElementById('waterfront-day-preview');
const get = id => root.querySelector(`#${id}`);
const dateInput = get('dp-date'), slider = get('dp-slider'), playButton = get('dp-play');
const number = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 1 });
const loader = createLatestLoader();
let forecast = null, selected = 36, timer = null, visuals;

function stopPlayback() {
  if (timer !== null) clearInterval(timer);
  timer = null; playButton.textContent = 'Play day'; playButton.setAttribute('aria-pressed', 'false');
}

function setStatus(message, state = 'ready') {
  get('dp-status').textContent = message;
  get('dp-status').parentElement.dataset.state = state;
  get('dp-retry').hidden = state !== 'error';
  get('dp-content').setAttribute('aria-busy', String(state === 'loading'));
}

function clearProjection() {
  forecast = null; visuals?.setForecast(null);
  slider.disabled = true; playButton.disabled = true;
  get('dp-value').textContent = '—'; get('dp-delta').textContent = 'Awaiting projection';
  get('dp-dwell').textContent = '—'; get('dp-dwell-baseline').textContent = 'Typical —';
  get('dp-reasons').replaceChildren(); get('dp-windows').replaceChildren();
  get('dp-event-detail').replaceChildren(); get('dp-event-detail').hidden = true;
}

async function loadDate() {
  stopPlayback(); dateInput.min = minimumDate();
  const date = dateInput.value;
  loader.cancel(); clearProjection();
  if (!isFutureDate(date)) {
    get('dp-day').textContent = 'Future-day projection';
    get('dp-baseline-label').textContent = 'Typical weekday';
    dateInput.setCustomValidity('Choose tomorrow or a later date in Vancouver.');
    setStatus('Choose a future date, starting tomorrow in Vancouver.', 'invalid');
    return;
  }
  dateInput.setCustomValidity('');
  get('dp-day').textContent = dayLabel(date);
  get('dp-baseline-label').textContent = `Typical ${weekday(date)}`;
  setStatus(`Loading the projections for ${dayLabel(date)}…`, 'loading');
  try {
    const result = await loader.load(date);
    if (result.stale) return;
    forecast = result.data;
    // The tab may have crossed midnight while a long request was running.
    if (!isFutureDate(date)) { void loadDate(); return; }
    visuals.setForecast(forecast);
    slider.disabled = false; playButton.disabled = false;
    buildQuickWindows(); buildEventDetail(); updateSelection(false);
    setStatus(`${forecast.demo ? 'Demo data · ' : ''}48 half-hour intervals · dwell in minutes · Vancouver local time`);
  } catch (error) {
    setStatus(error.message || 'The projection could not be loaded.', 'error');
  }
}

function reason(title, detail = '') {
  const item = document.createElement('div'); item.className = 'dp-contrib';
  const heading = document.createElement('div'); heading.textContent = title; item.append(heading);
  if (detail) { const tag = document.createElement('div'); tag.className = 'dp-tag'; tag.textContent = detail; item.append(tag); }
  return item;
}

function updateSelection(announce = true) {
  const interval = `${slotLabel(selected)}–${slotLabel(selected + 1)}`;
  slider.value = selected; slider.setAttribute('aria-valuetext', interval);
  get('dp-time').textContent = interval; get('dp-selected').textContent = interval;
  if (!forecast) return;
  const current = forecast.selectedDay[selected], typical = forecast.typicalDay[selected];
  get('dp-value').textContent = number.format(current.volume);
  const comparison = volumeComparison(current.volume, typical.volume);
  get('dp-delta').textContent = comparison.percent === null
    ? `Typical projection: ${number.format(typical.volume)} users`
    : `${comparison.percent > 0 ? '+' : ''}${comparison.percent}% vs usual · ${number.format(typical.volume)} users`;
  get('dp-dwell').textContent = `${decimal.format(current.dwellTime)} min`;
  get('dp-dwell-baseline').textContent = `Typical dwell: ${decimal.format(typical.dwellTime)} min`;
  const context = contextForSlot(forecast, selected);
  get('dp-reasons').replaceChildren(
    reason(context.weather.title, context.weather.detail),
    reason(context.holiday, weekday(forecast.date)),
    reason(context.event?.name || 'Events', context.events),
  );
  visuals.select(selected);
  get('dp-windows').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.index) === selected)));
  if (announce) get('dp-a11y').textContent = `${interval}: ${number.format(current.volume)} projected users; average dwell ${decimal.format(current.dwellTime)} minutes.`;
}

function select(index) { stopPlayback(); selected = index; updateSelection(); }

function buildQuickWindows() {
  get('dp-windows').replaceChildren();
  const rows = forecast.selectedDay.map((slot, i) => ({ ...slot, i }));
  const peak = rows.reduce((a, b) => a.volume >= b.volume ? a : b);
  const quiet = rows.filter(row => row.i >= 16 && row.i <= 40).reduce((a, b) => a.volume <= b.volume ? a : b);
  const windows = [['Peak activity', peak.i], ['Quieter daytime window', quiet.i]];
  const event = eventWindow(forecast.context.events?.event, forecast.date);
  if (event) windows.push([event.startLabel.startsWith('Previous') ? 'Event active' : 'Event starts', Math.max(0, Math.min(47, Math.floor(event.startSlot)))]);
  for (const [label, index] of windows) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.index = index;
    button.textContent = `${label} · ${slotLabel(index)}`;
    button.addEventListener('click', () => select(index)); get('dp-windows').append(button);
  }
}

function buildEventDetail() {
  const target = get('dp-event-detail'); target.replaceChildren();
  const event = eventWindow(forecast.context.events?.event, forecast.date);
  target.hidden = !event;
  if (!event) return;
  const name = document.createElement(event.sourceUrl ? 'a' : 'span'); name.textContent = event.name;
  if (event.sourceUrl) { name.href = event.sourceUrl; name.target = '_blank'; name.rel = 'noopener noreferrer'; }
  target.append(name, document.createTextNode(` · ${event.startLabel}–${event.endLabel}${event.endTimeEstimated ? ' (estimated end)' : ''}`));
}

dateInput.min = minimumDate(); dateInput.value = dateInput.min;
dateInput.addEventListener('change', loadDate);
dateInput.addEventListener('focus', () => { dateInput.min = minimumDate(); });
get('dp-retry').addEventListener('click', loadDate);
slider.addEventListener('input', () => select(Number(slider.value)));
playButton.addEventListener('click', () => {
  if (!forecast) return;
  if (timer !== null) { stopPlayback(); return; }
  if (selected >= 47) selected = 0;
  playButton.textContent = 'Pause'; playButton.setAttribute('aria-pressed', 'true');
  updateSelection(false);
  timer = setInterval(() => {
    selected = Math.min(47, selected + 1); updateSelection(false);
    if (selected === 47) { stopPlayback(); updateSelection(true); }
  }, CONFIG.playbackMs);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPlayback();
  else { dateInput.min = minimumDate(); if (forecast && !isFutureDate(dateInput.value)) void loadDate(); }
});
window.addEventListener('pagehide', () => { stopPlayback(); loader.cancel(); });

try {
  visuals = createVisuals(root, select);
  // Load static map assets independently of the backend forecast request.
  visuals.loadGeometry().catch(error => {
    root.querySelector('.dp-map-credit').append(document.createTextNode(` ${error.message}`));
  });
  void loadDate();
} catch (error) { setStatus(error.message, 'error'); }
