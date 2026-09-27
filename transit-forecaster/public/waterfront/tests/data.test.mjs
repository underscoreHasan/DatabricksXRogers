import test from 'node:test';
import assert from 'node:assert/strict';
import * as data from '../js/data.js';

function fixture() {
  const slots = Array.from({ length: 48 }, (_, i) => ({
    time: `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`,
    volume: 120, dwellTime: 18,
  }));
  return { date: '2026-10-03', timezone: 'America/Vancouver', dwellTimeUnit: 'minutes',
    selectedDay: structuredClone(slots), typicalDay: structuredClone(slots),
    context: { events: { date: '2026-10-03', lookupStatus: 'partial', hasHighAttendanceEvent: null, event: null } } };
}

test('future-date boundary uses the backend Vancouver clock, not UTC or the viewer clock', () => {
  assert.equal(typeof data.minimumDate, 'function');
  assert.equal(data.minimumDate(new Date('2026-09-28T06:59:59Z')), '2026-09-28');
  assert.equal(data.minimumDate(new Date('2026-09-28T07:00:00Z')), '2026-09-29');
  assert.equal(data.minimumDate(new Date('2026-12-01T07:30:00Z')), '2026-12-02');
  assert.equal(data.isFutureDate('2026-09-27', new Date('2026-09-27T17:00:00Z')), false);
  assert.equal(data.isFutureDate('2026-09-28', new Date('2026-09-27T17:00:00Z')), true);
  assert.equal(data.isFutureDate('2027-02-30', new Date('2026-09-27T17:00:00Z')), false);
});

test('requires two complete aligned projections, correct date, and nonnegative numeric values', () => {
  assert.equal(typeof data.normalizeForecast, 'function');
  const good = fixture();
  assert.equal(data.normalizeForecast(good, '2026-10-03').selectedDay[47].time, '23:30');
  for (const mutate of [
    x => x.selectedDay.pop(),
    x => x.typicalDay[1].time = '00:00',
    x => x.selectedDay[0].volume = -1,
    x => x.selectedDay[0].dwellTime = '18',
    x => x.date = '2026-10-04',
    x => x.dwellTimeUnit = 'seconds',
  ]) {
    const bad = fixture(); mutate(bad);
    assert.throws(() => data.normalizeForecast(bad, '2026-10-03'));
  }
  good.selectedDay[0].volume = 0;
  good.selectedDay[0].dwellTime = 0;
  assert.equal(data.normalizeForecast(good, '2026-10-03').selectedDay[0].volume, 0);
});

test('zero baselines never produce Infinity or a made-up percentage', () => {
  assert.equal(typeof data.volumeComparison, 'function');
  assert.equal(data.volumeComparison(150, 100).percent, 50);
  assert.equal(data.volumeComparison(0, 0).percent, null);
  assert.equal(data.volumeComparison(10, 0).percent, null);
  assert.equal(data.volumeComparison(75, 100).percent, -25);
});

test('event conversion retains estimated ends and clips a previous-night event to the selected day', () => {
  assert.equal(typeof data.eventWindow, 'function');
  const result = data.eventWindow({ name: '<b>Concert</b>', startTime: '2026-10-03T06:30:00Z',
    endTime: '2026-10-03T09:00:00Z', endTimeEstimated: true, sourceUrl: 'javascript:alert(1)' }, '2026-10-03');
  assert.equal(result.startSlot, 0);
  assert.equal(result.endSlot, 4);
  assert.equal(result.startLabel, 'Previous day 23:30');
  assert.equal(result.endLabel, '02:00');
  assert.equal(result.endTimeEstimated, true);
  assert.equal(result.sourceUrl, null);
});

test('partial event lookup remains unknown and historical weather is labeled as an average', () => {
  assert.equal(typeof data.contextForSlot, 'function');
  const f = fixture();
  f.context.holiday = { date: f.date, isHoliday: false };
  f.context.weather = { date: f.date, mode: 'historical_average', weather: Array.from({length:48}, () => ({temp_c:15.8,rain:true,precip_mm:.3,rain_mm:.3})) };
  const result = data.contextForSlot(f, 0);
  assert.match(result.events, /partial|incomplete/i);
  assert.match(result.weather.detail, /historical|seasonal/i);
  assert.match(result.holiday, /not a statutory holiday/i);
});
