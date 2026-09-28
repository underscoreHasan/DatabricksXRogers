import { CONFIG } from './config.js';
import { createLatestLoader, requestDay } from './api.js';
import { minimumDate, isFutureDate, weekday, dayLabel, slotLabel, volumeComparison, contextForSlot, eventWindow, rainWindows, applyVolumeBoosts, smoothTypicalDay } from './data.js';
import { createVisuals } from './visual.js';

const root = document.getElementById('waterfront-day-preview');
const get = id => root.querySelector(`#${id}`);
const dateInput = get('dp-date'), slider = get('dp-slider'), playButton = get('dp-play');
const number = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 1 });
const loader = createLatestLoader(requestDay);
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
  get('dp-rain-detail').textContent = '';
  get('dp-selected-label').textContent = 'Selected day';
  get('dp-value-label').textContent = 'Connections / 30 min';
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
    const result = await loader.load(date, { onUpdate: renderForecast });
    if (result.stale) return;
    // The tab may have crossed midnight while a long request was running.
    if (!isFutureDate(date)) { void loadDate(); return; }
    renderForecast(result.data);
  } catch (error) {
    setStatus(error.message || 'The projection could not be loaded.', 'error');
  }
}

function renderForecast(value) {
  const dummyBaseline = value.baselineSources?.volume === 'dummy';
  const baseline = dummyBaseline ? (['Saturday', 'Sunday'].includes(weekday(value.date)) ? 'Typical weekend' : 'Typical weekday') : `Typical ${weekday(value.date)}`;
  if (value.forecastPending) {
    forecast = value;
    visuals.setForecast(null);
    slider.disabled = true; playButton.disabled = true;
    get('dp-selected-label').textContent = 'Selected day · loading';
    get('dp-baseline-label').textContent = `${baseline} · loading`;
    buildEventDetail(); updateSelection(false);
    setStatus('Loading selected-day forecast and typical baseline from Databricks…', 'loading');
    return;
  }
  forecast = smoothTypicalDay(applyVolumeBoosts(value));
  const sourceLabel = source => source === 'model' ? 'Databricks' : source === 'fallback' ? 'demo fallback' : 'demo';
  get('dp-selected-label').textContent = `Selected day · ${sourceLabel(forecast.sources.selectedDay)}`;
  get('dp-baseline-label').textContent = `${baseline} · ${dummyBaseline ? 'dummy fallback' : sourceLabel(forecast.sources.typicalDay)} · smoothed`;
  get('dp-value-label').textContent = 'Connections / 30 min';
  visuals.setForecast(forecast);
  slider.disabled = false; playButton.disabled = false;
  buildQuickWindows(); buildEventDetail(); updateSelection(false);
  const adjusted = forecast.selectedDay.some(slot => slot.eventBoost || slot.rainBoost);
  const hasFallback = [...Object.values(forecast.sources), ...Object.values(forecast.dwellSources)].includes('fallback');
  const source = hasFallback ? `Demo fallback for unavailable data. ${forecast.forecastError || ''}`
    : forecast.demo ? 'Demo forecast' : dummyBaseline ? 'Databricks forecast · dummy baseline fallback' : 'Databricks forecasts';
  setStatus(`${source} · 48 half-hour intervals · Vancouver local time${adjusted ? ' · Includes simple event/rain boosts' : ''}`, hasFallback ? 'error' : 'ready');
  get('dp-retry').hidden = false;
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
  const current = forecast.selectedDay?.[selected], typical = forecast.typicalDay?.[selected];
  const context = contextForSlot(forecast, selected);
  get('dp-reasons').replaceChildren(
    reason(context.weather.title, `${context.weather.detail}${current?.rainBoost ? ` · Rain boost: +${current.rainBoost} connections` : ''}`),
    reason(context.holiday, weekday(forecast.date)),
    reason(context.event?.name || 'Events', `${context.events}${current?.eventBoost ? ` · Event boost: +${current.eventBoost} connections` : ''}`),
  );
  if (!current || !typical) return;
  get('dp-value').textContent = number.format(current.volume);
  const comparison = volumeComparison(current.volume, typical.volume);
  get('dp-delta').textContent = comparison.percent === null
    ? `Typical projection: ${number.format(typical.volume)} connections`
    : `${comparison.percent > 0 ? '+' : ''}${comparison.percent}% vs typical · ${number.format(typical.volume)} connections`;
  get('dp-dwell').textContent = `${decimal.format(current.dwellTime)} min`;
  get('dp-dwell-baseline').textContent = `Typical dwell: ${decimal.format(typical.dwellTime)} min${forecast.baselineSources?.dwell === 'dummy' ? ' · dummy baseline' : ''}`;
  visuals.select(selected);
  get('dp-windows').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.index) === selected)));
  if (announce) get('dp-a11y').textContent = `${interval}: ${number.format(current.volume)} connections; average dwell ${decimal.format(current.dwellTime)} minutes.`;
}

function select(index) { stopPlayback(); selected = index; updateSelection(); }

function buildQuickWindows() {
  get('dp-windows').replaceChildren();
  const rows = forecast.selectedDay.map((slot, i) => ({ ...slot, i }));
  const peak = rows.reduce((a, b) => a.volume >= b.volume ? a : b);
  const quiet = rows.filter(row => row.i >= 16 && row.i <= 40).reduce((a, b) => a.volume <= b.volume ? a : b);
  const windows = [['Peak activity', peak.i], ['Quieter daytime window', quiet.i]];
  const event = eventWindow(forecast.context.events?.event, forecast.date);
  if (event) {
    windows.push([event.startsBeforeDay ? 'Event active' : 'Event starts', Math.min(47, Math.floor(event.startSlot)), event.startsBeforeDay ? '00:00' : event.startLabel]);
    if (!event.endsAfterDay) windows.push(['Event ends', Math.max(0, Math.min(47, Math.ceil(event.endSlot) - 1)), event.endLabel]);
  }
  const rain = rainWindows(forecast.context.weather, forecast.date);
  if (rain.length) windows.push([forecast.context.weather.mode === 'historical_average' ? 'Rainfall average' : 'Rain begins', rain[0].startSlot]);
  for (const [label, index, time = slotLabel(index)] of windows) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.index = index;
    button.textContent = `${label} · ${time}`;
    button.addEventListener('click', () => select(index)); get('dp-windows').append(button);
  }
}

function buildEventDetail() {
  const weather = forecast.context.weather;
  const rain = rainWindows(weather, forecast.date);
  const rainLabel = weather?.mode === 'historical_average' ? 'Historical rainfall average' : 'Rain forecast';
  get('dp-rain-label').textContent = weather?.mode === 'historical_average' ? 'Rainfall average' : 'Rain';
  get('dp-rain-detail').textContent = rain.length
    ? `${rainLabel}: ${rain.map(window => `${window.startLabel}–${window.endLabel}`).join(', ')} (Vancouver time).`
    : weather ? 'No rain indicated in the weather data.' : forecast.contextPending ? 'Loading rain windows…' : 'Rain windows unavailable.';
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
