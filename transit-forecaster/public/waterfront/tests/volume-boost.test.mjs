import test from 'node:test';
import assert from 'node:assert/strict';
import * as data from '../js/data.js';

const date = '2026-10-03';
function fixture() {
  const rows = Array.from({ length: 48 }, (_, i) => ({ time: data.slotLabel(i), volume: 500, dwellTime: 20 }));
  return { date, selectedDay: structuredClone(rows), typicalDay: structuredClone(rows), context: {} };
}
function event(size = 'large') {
  return { date, lookupStatus: 'ok', event: { name: 'Concert', size,
    startTime: '2026-10-04T01:15:00Z', endTime: '2026-10-04T02:00:00Z' } };
}
function weather() {
  return { date, weather: Array.from({ length: 48 }, (_, i) => ({
    time_local: `${date}T${data.slotLabel(i)}:00-07:00`, rain: false, rain_mm: 0,
  })) };
}
function boost(value) {
  assert.equal(typeof data.applyVolumeBoosts, 'function', 'selected-day volume adjustments must be implemented');
  return data.applyVolumeBoosts(value);
}

test('event size boosts only overlapping half-hours, leaving typical volume and all dwell unchanged', () => {
  for (const [size, expected] of [['small', 600], ['medium', 700], ['large', 800]]) {
    const input = fixture();
    input.context.events = event(size);
    const result = boost(input);
    assert.equal(result.selectedDay[35].volume, 500);
    assert.equal(result.selectedDay[36].volume, expected); // 18:00-18:30 overlaps the 18:15 start.
    assert.equal(result.selectedDay[37].volume, expected);
    assert.equal(result.selectedDay[38].volume, 500); // 19:00 end is exclusive.
    assert.ok(result.selectedDay.every(row => row.dwellTime === 20));
    assert.deepEqual(result.typicalDay, input.typicalDay);
    assert.ok(input.selectedDay.every(row => row.volume === 500));
  }
});

test('rain amount chooses a small fixed increment per wet interval and caps heavy rain', () => {
  const input = fixture();
  input.context.weather = weather();
  const amounts = [0, 0.1, 0.99, 1, 3.99, 4, 100];
  amounts.forEach((amount, i) => Object.assign(input.context.weather.weather[i], { rain: amount > 0, rain_mm: amount }));
  const result = boost(input);
  assert.deepEqual(result.selectedDay.slice(0, 8).map(row => row.volume), [500, 550, 550, 600, 600, 650, 650, 500]);
  assert.deepEqual(result.typicalDay, input.typicalDay);
});

test('event and rain boosts add once and expose their amounts for the UI', () => {
  const input = fixture();
  input.context.events = event();
  input.context.weather = weather();
  Object.assign(input.context.weather.weather[36], { rain: true, rain_mm: 2 });
  const first = boost(input);
  assert.equal(first.selectedDay[36].volume, 900);
  assert.equal(first.selectedDay[36].baseVolume, 500);
  assert.equal(first.selectedDay[36].eventBoost, 300);
  assert.equal(first.selectedDay[36].rainBoost, 100);
  assert.deepEqual(boost(first), first);
  first.context = {};
  assert.equal(boost(first).selectedDay[36].volume, 500);
});

test('unavailable, wrong-date, misaligned and invalid inputs do not invent boosts', () => {
  for (const mutate of [
    () => {},
    input => { input.context.events = { ...event(), lookupStatus: 'unavailable' }; },
    input => { input.context.events = { ...event(), date: '2026-10-04' }; },
    input => { input.context.events = event('unknown'); },
    input => { input.context.weather = { ...weather(), date: '2026-10-04' }; input.context.weather.weather[0].rain_mm = 2; },
    input => { input.context.weather = weather(); Object.assign(input.context.weather.weather[0], { rain: true, rain_mm: 2, time_local: `${date}T01:00:00-07:00` }); },
    ...[undefined, null, NaN, -1, '2'].map(amount => input => { input.context.weather = weather(); Object.assign(input.context.weather.weather[0], { rain: true, rain_mm: amount }); }),
  ]) {
    const input = fixture(); mutate(input);
    assert.ok(boost(input).selectedDay.every(row => row.volume === 500));
  }
});

test('an overnight event boosts the overlapping slots in the selected Vancouver day', () => {
  const input = fixture();
  input.context.events = event('small');
  input.context.events.event.startTime = '2026-10-03T06:45:00Z';
  input.context.events.event.endTime = '2026-10-03T07:30:00Z';
  const result = boost(input);
  assert.equal(result.selectedDay[0].volume, 600);
  assert.equal(result.selectedDay[1].volume, 500);
});
