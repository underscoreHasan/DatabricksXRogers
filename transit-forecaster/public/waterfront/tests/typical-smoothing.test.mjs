import test from 'node:test';
import assert from 'node:assert/strict';
import * as data from '../js/data.js';

function fixture() {
  const rows = Array.from({ length: 48 }, (_, i) => ({ time: data.slotLabel(i), volume: 0, dwellTime: 20 }));
  return { selectedDay: structuredClone(rows), typicalDay: structuredClone(rows) };
}
function smooth(value) {
  assert.equal(typeof data.smoothTypicalDay, 'function');
  return data.smoothTypicalDay(value);
}

test('a five-slot mean softens typical spikes without changing selected-day detail or dwell', () => {
  const value = fixture();
  value.selectedDay[12].volume = 900;
  value.typicalDay[12].volume = 500;
  const result = smooth(value);
  assert.deepEqual(result.typicalDay.slice(9, 16).map(row => row.volume), [0, 100, 100, 100, 100, 100, 0]);
  assert.deepEqual(result.selectedDay, value.selectedDay);
  assert.ok(result.typicalDay.every(row => row.dwellTime === 20));
  assert.equal(result.typicalDay[12].baseVolume, 500);
  assert.equal(value.typicalDay[12].volume, 500);
  assert.equal(result.typicalDay.length, 48);
});

test('day edges average only available neighbors without wrapping across midnight', () => {
  const value = fixture();
  value.typicalDay[47].volume = 300;
  const result = smooth(value);
  assert.deepEqual(result.typicalDay.slice(44).map(row => row.volume), [0, 60, 75, 100]);
  assert.equal(result.typicalDay[0].volume, 0);
  assert.equal(result.typicalDay[47].time, '23:30');
});

test('constant baselines and repeated renders remain stable', () => {
  const value = fixture();
  value.typicalDay.forEach(row => { row.volume = 37; });
  assert.ok(smooth(value).typicalDay.every(row => row.volume === 37));
  value.typicalDay[12].volume = 500;
  const once = smooth(value);
  assert.deepEqual(smooth(once), once);
});
