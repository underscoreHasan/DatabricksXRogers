import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../js/api.js';

test('sends one date-only request and surfaces HTTP errors', async () => {
  assert.equal(typeof api.requestForecast, 'function');
  let request;
  await assert.rejects(api.requestForecast('2026-10-03', {
    endpoint: '/api/forecast', now: new Date('2026-09-27T17:00:00Z'),
    fetchImpl: async (url, options) => {
      request = {url, options};
      return new Response(JSON.stringify({error:'Model unavailable'}), { status:503 });
    },
  }), /503/);
  assert.equal(request.url, '/api/forecast?date=2026-10-03');
  assert.equal(request.options.method, 'GET');
});

test('today and past dates are rejected before any request is sent', async () => {
  assert.equal(typeof api.requestForecast, 'function');
  let called = false;
  await assert.rejects(api.requestForecast('2026-09-27', { now:new Date('2026-09-27T17:00:00Z'), fetchImpl: async () => {called=true;} }), /future|tomorrow/i);
  assert.equal(called, false);
});

test('rapid date changes discard an older response even if the transport ignores cancellation', async () => {
  assert.equal(typeof api.createLatestLoader, 'function');
  const pending = new Map();
  const loader = api.createLatestLoader(date => new Promise(resolve => pending.set(date, resolve)));
  const first = loader.load('2026-10-03');
  const second = loader.load('2026-10-04');
  pending.get('2026-10-04')({ date: '2026-10-04' });
  assert.deepEqual(await second, { stale:false, data:{date:'2026-10-04'} });
  pending.get('2026-10-03')({ date: '2026-10-03' });
  assert.deepEqual(await first, { stale:true });
});
