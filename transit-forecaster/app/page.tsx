'use client'

import { useMemo, useState } from 'react'
import { Activity, CalendarDays, Network, RotateCcw } from 'lucide-react'

const location = { name: 'Waterfront', color: '#c2410c', fill: '#fed7aa', base: 68 }
const hours = ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00']

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-CA', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00`))
}

export default function Page() {
  const [selectedDate, setSelectedDate] = useState('2026-10-01')

  const { modeledPoints, predictedPoints } = useMemo(() => {
    const daySeed = new Date(`${selectedDate}T12:00:00`).getDate()
    const weekend = [0, 6].includes(new Date(`${selectedDate}T12:00:00`).getDay())
    return {
      modeledPoints: Array.from({ length: 13 }, (_, index) => {
        const hour = index * 2
        const morning = Math.max(0, 1 - Math.abs(hour - 8) / 4)
        const evening = Math.max(0, 1 - Math.abs(hour - 17) / 5)
        const historicalVariation = (daySeed * 3 + index * 2) % 5
        return Math.round(Math.min(99, location.base - 10 + morning * 18 + evening * 22 + (weekend ? 4 : 0) + historicalVariation))
      }),
      predictedPoints: Array.from({ length: 13 }, (_, index) => {
        const hour = index * 2
        const morning = Math.max(0, 1 - Math.abs(hour - 8) / 4)
        const evening = Math.max(0, 1 - Math.abs(hour - 17) / 5)
        const eventPulse = daySeed % 3 === 0 ? Math.max(0, 1 - Math.abs(hour - 19) / 5) * 18 : 0
        const forecastDrift = Math.sin((index + daySeed) * 0.8) * 3
        return Math.round(Math.min(99, location.base + morning * 30 + evening * 38 + (weekend ? 10 : 0) + eventPulse + forecastDrift))
      }),
    }
  }, [selectedDate])

  const chartPoints = predictedPoints.map((value, index) => `${(index / 12) * 100},${100 - value}`).join(' ')
  const modeledChartPoints = modeledPoints.map((value, index) => `${(index / 12) * 100},${100 - value}`).join(' ')
  const peak = Math.max(...predictedPoints)
  const peakHour = `${String(predictedPoints.indexOf(peak) * 2).padStart(2, '0')}:00`

  return (
    <main className="min-h-screen bg-[#f4f7f5] text-[#15302b] selection:bg-teal-600/30">
      <header className="flex h-[72px] items-center justify-between border-b border-[#dbe8e3] px-5 sm:px-8">
        <div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center rounded-xl bg-teal-600 text-white"><Activity size={20} /></div><div><div className="text-[15px] font-semibold tracking-tight">Transit<span className="text-teal-700">Pulse</span></div><div className="mt-0.5 text-[10px] uppercase tracking-[0.2em] text-slate-500">Research workspace</div></div></div>
        <div className="hidden items-center gap-2 text-[11px] text-slate-500 sm:flex"><span className="size-1.5 rounded-full bg-emerald-500" /> Forecast simulator · Vancouver network</div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-8 sm:py-8">
        <section className="overflow-hidden rounded-2xl border border-teal-700/20 bg-white shadow-[0_20px_80px_rgba(20,83,75,0.10)]">
          <div className="border-b border-[#e3eeea] p-5 sm:p-7"><div className="flex flex-wrap items-center gap-2"><span className="flex size-8 items-center justify-center rounded-lg bg-teal-600/10 text-teal-700"><Network size={16} /></span><h1 className="text-lg font-semibold">Traffic forecast map</h1><span className="rounded-full bg-violet-100 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-violet-700">Research mode</span></div><p className="mt-2 text-xs text-slate-500">Select a forecast day and one location to explore modeled traffic throughout the day.</p></div>

          <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="relative min-h-[560px] overflow-hidden border-b border-[#e3eeea] bg-[#e8f2ef] lg:border-b-0 lg:border-r" style={{ backgroundImage: 'linear-gradient(rgba(13,148,136,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(13,148,136,.07) 1px, transparent 1px)', backgroundSize: '42px 42px' }}>
              <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 52% 53%, ${location.fill}99, transparent 28%)` }} />
              <svg className="absolute inset-0 h-full w-full opacity-45" viewBox="0 0 900 570" preserveAspectRatio="none" aria-label="Stylized Vancouver traffic network map"><path d="M70 570 C110 430 90 300 180 160 S260 50 300 0 M350 570 C370 430 450 350 430 230 S500 120 600 0 M560 570 C600 450 690 390 670 260 S760 120 820 0 M0 170 C170 200 250 130 390 190 S650 250 900 210 M30 400 C180 340 270 420 400 370 S650 350 900 420" fill="none" stroke={location.color} strokeWidth="2" strokeDasharray="5 9" /><path d="M250 570 C300 460 330 310 300 0 M680 570 C640 430 720 300 650 0" fill="none" stroke="#64748b" strokeWidth="1" /></svg>
              <div className="absolute left-[52%] top-[48%] -translate-x-1/2 -translate-y-1/2"><span className="absolute -inset-7 animate-ping rounded-full opacity-30" style={{ backgroundColor: location.fill }} /><span className="relative flex size-16 items-center justify-center rounded-full border-4 border-white/70 text-sm font-bold text-white shadow-[0_0_32px_currentColor]" style={{ backgroundColor: location.color }}>{peak}%</span><div className="mt-2 rounded-md border border-white/70 bg-white/95 px-3 py-1.5 text-center shadow-sm"><div className="text-[11px] font-semibold">{location.name}</div><div className="text-[9px] text-slate-500">selected location · peak</div></div></div>
              <div className="absolute left-4 top-4 rounded-lg border border-white/70 bg-white/95 px-3 py-2 shadow-sm"><div className="text-[10px] uppercase tracking-wider text-slate-500">Forecast date</div><div className="mt-0.5 text-sm font-semibold">{formatDate(selectedDate)}</div></div>
              <div className="absolute bottom-4 left-4 right-4 rounded-xl border border-white/70 bg-white/95 p-4 shadow-lg backdrop-blur sm:left-7 sm:right-7"><div className="flex items-center justify-between text-[10px] text-slate-500"><span>Daily modeled traffic</span><span className="font-semibold" style={{ color: location.color }}>{location.name} · {peak}% peak at {peakHour}</span></div><div className="mt-3 h-32 w-full"><svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label={`${location.name} traffic forecast time series`}><polyline points={`0,100 ${chartPoints} 100,100`} fill={location.fill} opacity=".45" /><polyline points={modeledChartPoints} fill="none" stroke="#475569" strokeWidth="2.5" vectorEffect="non-scaling-stroke" /><polyline points={chartPoints} fill="none" stroke={location.color} strokeWidth="2.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" /></svg></div><div className="mt-1 flex justify-between text-[9px] text-slate-400">{hours.map((hour) => <span key={hour}>{hour}</span>)}</div></div>
            </div>

            <aside className="p-5 sm:p-7"><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Forecast controls</div><label className="mt-6 block text-xs font-medium text-[#294d45]" htmlFor="forecast-date"><span className="mb-2 flex items-center gap-2"><CalendarDays size={14} className="text-teal-700" /> Select a day</span><input id="forecast-date" type="date" min="2026-09-26" max="2027-09-26" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="w-full rounded-lg border border-[#cfe0da] bg-[#f8fbfa] px-3 py-2.5 text-xs text-[#15302b] outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15" /></label><div className="mt-6 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[11px] text-orange-800"><span className="font-semibold">Location:</span> Waterfront</div><div className="mt-8 rounded-xl border border-violet-200 bg-violet-50 p-4"><div className="text-[10px] font-semibold text-violet-700">Model snapshot</div><p className="mt-2 text-[11px] leading-relaxed text-slate-600">{location.name} reaches a modeled peak of {peak}% around {peakHour} on {formatDate(selectedDate)}. This is a research forecast, not a live traffic reading.</p></div><button onClick={() => { setSelectedDate('2026-10-01') }} className="mt-6 flex items-center gap-2 text-[10px] text-slate-500 hover:text-[#15302b]"><RotateCcw size={13} /> Reset forecast</button></aside>
          </div>
        </section>
      </div>
    </main>
  )
}
