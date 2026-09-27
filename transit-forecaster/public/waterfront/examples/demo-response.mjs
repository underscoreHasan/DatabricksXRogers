// Illustrative fixture only. No weather/event API or prediction model is called.
export function demoResponse(date) {
  const midnight = Date.parse(`${date}T00:00:00-07:00`);
  const time = i => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
  const typicalDay = Array.from({ length: 48 }, (_, i) => ({
    time: time(i), volume: Math.round(90 + 610 * Math.exp(-(((i - 17) / 5) ** 2)) + 720 * Math.exp(-(((i - 34) / 7) ** 2))),
    dwellTime: Math.round(12 + 8 * Math.exp(-(((i - 28) / 10) ** 2))),
  }));
  const selectedDay = typicalDay.map((slot, i) => ({ ...slot,
    volume: Math.round(slot.volume * .95 + 650 * Math.exp(-(((i - 38) / 4) ** 2))),
    dwellTime: slot.dwellTime + Math.round(14 * Math.exp(-(((i - 38) / 5) ** 2))),
  }));
  const day = new Date(`${date}T12:00:00Z`);
  return { date, timezone: 'America/Vancouver', dwellTimeUnit: 'minutes', demo: true, selectedDay, typicalDay,
    context: {
      dayOfWeek: { date, dayOfWeek: day.toLocaleDateString('en-CA', { weekday: 'long', timeZone: 'UTC' }), dayOfWeekNumber: day.getUTCDay() || 7 },
      holiday: { date, isHoliday: false },
      events: { date, lookupStatus: 'ok', hasHighAttendanceEvent: true, event: {
        name: 'Illustrative evening event', startTime: new Date(midnight + 19 * 3600000).toISOString(),
        endTime: new Date(midnight + 22 * 3600000).toISOString(), endTimeEstimated: true, size: 'large', sourceUrl: null,
      } },
      weather: { date, timezone: 'America/Vancouver', mode: 'forecast', years_used: [],
        start_time: new Date(midnight).toISOString(), slot_minutes: 30, source_interval_minutes: 60, n_slots: 48,
        weather: Array.from({ length: 48 }, (_, i) => ({
          time: new Date(midnight + i * 1800000).toISOString(), time_local: `${date}T${time(i)}:00-07:00`,
          rain: false, temp_c: 16 + Math.round(5 * Math.sin(Math.floor(i / 2) / 24 * Math.PI)), precip_mm: 0, rain_mm: 0,
        })),
      },
    },
  };
}
