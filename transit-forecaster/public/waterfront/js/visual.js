import { CONFIG } from './config.js';
import { slotLabel, eventWindow, rainWindows } from './data.js';

/** Map and chart renderer, preserving the original preview's design. */
export function createVisuals(root, onSelect) {
  const d3 = window.d3;
  if (!d3) throw new Error('The bundled chart library could not be loaded.');
  const map = d3.select(root.querySelector('#dp-map'));
  const chart = d3.select(root.querySelector('#dp-chart'));
  let geometry = null, forecast = null, selected = 36, x, y, markerScale;

  function drawMap() {
    const width = map.node().clientWidth, height = map.node().clientHeight;
    if (!width || !height) return;
    map.attr('viewBox', `0 0 ${width} ${height}`).selectAll('*').remove();
    const projection = d3.geoMercator().center([-123.1115, 49.286])
      .scale(Math.min(width / .00026, height / .00019)).translate([width / 2, height / 2]);
    const path = d3.geoPath(projection);
    map.append('defs').append('clipPath').attr('id', 'dp-map-clip').append('rect').attr('width', width).attr('height', height);
    const base = map.append('g').attr('clip-path', 'url(#dp-map-clip)');
    if (geometry) {
      base.selectAll('.building').data(geometry.buildings.features).join('path').attr('d', path).attr('fill', 'var(--dp-block)');
      base.selectAll('.road').data(geometry.streets.features).join('path').attr('d', path).attr('fill', 'none').attr('stroke', 'var(--dp-road)').attr('stroke-width', 1.1);
      const street = geometry.streets.features.find(feature => {
        if (!feature.properties.name.endsWith('W CORDOVA ST')) return false;
        const [cx, cy] = path.centroid(feature);
        return cx > 55 && cx < width - 100 && cy > 50 && cy < height - 30;
      });
      if (street) {
        const [cx, cy] = path.centroid(street);
        base.append('text').attr('class', 'dp-map-label').attr('x', cx).attr('y', cy - 5).text('W Cordova St');
      }
    }
    const [cx, cy] = projection([CONFIG.location.longitude, CONFIG.location.latitude]);
    const marker = map.append('g').attr('transform', `translate(${cx},${cy})`);
    marker.append('circle').attr('id', 'dp-map-fill').attr('fill', 'var(--dp-blue)').attr('fill-opacity', .22);
    marker.append('circle').attr('id', 'dp-map-typical').attr('fill', 'none').attr('stroke', 'var(--dp-sub)').attr('stroke-width', 1.5).attr('stroke-dasharray', '4 4');
    marker.append('circle').attr('r', 4).attr('fill', 'var(--dp-blue)');
    marker.append('text').attr('class', 'dp-map-label').attr('text-anchor', 'middle').attr('y', -85).style('fill', 'var(--dp-text)').style('font-weight', 500).text('Waterfront Station');
    if (!geometry) map.append('text').attr('class', 'dp-map-label').attr('x', 16).attr('y', height - 16).text('Map geometry not loaded');
  }

  function drawChart() {
    const width = chart.node().clientWidth, height = 218;
    if (!width) return;
    const left = 48, right = 12, top = 26, bottom = 74;
    chart.attr('viewBox', `0 0 ${width} ${height}`).selectAll('*').remove();
    if (!forecast) {
      chart.append('text').attr('class', 'dp-chart-title').attr('x', width / 2).attr('y', 80).attr('text-anchor', 'middle').text('Awaiting day projections');
      return;
    }
    const rows = forecast.selectedDay.map((slot, i) => ({i, selected:slot.volume, typical:forecast.typicalDay[i].volume}));
    const maximum = Math.max(1, d3.max(rows, row => Math.max(row.selected, row.typical)));
    markerScale = d3.scaleSqrt().domain([0, maximum]).range([0, 76]);
    x = d3.scaleLinear().domain([0, 48]).range([left, width - right]);
    y = d3.scaleLinear().domain([0, maximum * 1.14]).nice().range([height - bottom, top]);
    chart.append('text').attr('class', 'dp-axis-label').attr('x', left).attr('y', 13).text('Connections / 30 min');
    chart.append('text').attr('class', 'dp-axis-label').attr('text-anchor', 'end').attr('x', width - right).attr('y', height - 1).text('Local time');
    chart.append('g').attr('class', 'dp-axis').attr('transform', `translate(${left},0)`)
      .call(d3.axisLeft(y).ticks(3).tickFormat(d3.format('~s')).tickSize(-(width - left - right)))
      .call(group => group.select('.domain').remove());
    chart.append('g').attr('class', 'dp-axis').attr('transform', `translate(0,${height - bottom})`)
      .call(d3.axisBottom(x).tickValues(width < 420 ? [0,16,32,48] : [0,8,16,24,32,40,48]).tickFormat(slotLabel));
    const line = key => d3.line().x(row => x(row.i + .5)).y(row => y(row[key])).curve(d3.curveMonotoneX)(rows);
    chart.append('path').datum(rows).attr('fill', 'var(--dp-blue)').attr('fill-opacity', .08)
      .attr('d', d3.area().x(row => x(row.i + .5)).y0(y(0)).y1(row => y(row.selected)).curve(d3.curveMonotoneX));
    chart.append('path').attr('class', 'dp-selected-line').attr('fill', 'none').attr('stroke', 'var(--dp-blue)').attr('stroke-width', 2.5).attr('d', line('selected'));
    // Draw the dashed baseline on top with a halo so equal series stay distinguishable.
    chart.append('path').attr('fill', 'none').attr('stroke', 'var(--dp-bg)').attr('stroke-width', 5).attr('stroke-dasharray', '5 4').attr('d', line('typical'));
    chart.append('path').attr('class', 'dp-typical-line').attr('fill', 'none').attr('stroke', 'var(--dp-sub)').attr('stroke-width', 2).attr('stroke-dasharray', '5 4').attr('d', line('typical'));
    const event = eventWindow(forecast.context.events?.event, forecast.date);
    const eventY = height - 40, rainY = height - 23;
    for (const [label, bandY] of [['Event', eventY], ['Rain', rainY]]) {
      chart.append('text').attr('class', 'dp-axis-label').attr('x', left - 8).attr('y', bandY + 7).attr('text-anchor', 'end').text(label);
      chart.append('rect').attr('x', left).attr('y', bandY).attr('width', width - left - right).attr('height', 8).attr('rx', 2).attr('fill', 'var(--dp-panel)');
    }
    if (event) {
      chart.append('rect').attr('class', 'dp-event-band').attr('x', x(event.startSlot)).attr('y', eventY).attr('height', 8)
        .attr('width', x(event.endSlot) - x(event.startSlot)).attr('fill', 'var(--dp-orange)').attr('fill-opacity', .7)
        .on('click', () => onSelect(Math.min(47, Math.floor(event.startSlot))))
        .append('title').text(`${event.name}: ${event.startLabel}–${event.endLabel}${event.endTimeEstimated ? ' (estimated end)' : ''}`);
      for (const [kind, slot, label] of [
        ['start', event.startSlot, event.startsBeforeDay ? 'Continues from previous day' : `Starts ${event.startLabel}`],
        ['end', event.endSlot, event.endsAfterDay ? 'Continues into next day' : `Ends ${event.endLabel}${event.endTimeEstimated ? ' (estimated)' : ''}`],
      ]) {
        const marker = chart.append('g').attr('class', `dp-event-${kind}`);
        marker.append('line').attr('x1', x(slot)).attr('x2', x(slot)).attr('y1', top).attr('y2', eventY + 8)
          .attr('stroke', 'var(--dp-orange)').attr('stroke-width', 1.5).attr('stroke-dasharray', '3 3');
        marker.append('circle').attr('cx', x(slot)).attr('cy', eventY + 4).attr('r', 3).attr('fill', 'var(--dp-orange)');
        marker.append('title').text(`${event.name} · ${label}`);
      }
    }
    const rainLabel = forecast.context.weather?.mode === 'historical_average' ? 'Historical rainfall average' : 'Rain forecast';
    for (const rain of rainWindows(forecast.context.weather, forecast.date)) {
      chart.append('rect').attr('class', 'dp-rain-band').attr('x', x(rain.startSlot)).attr('y', rainY).attr('height', 8)
        .attr('width', x(rain.endSlot) - x(rain.startSlot)).attr('fill', 'var(--dp-rain)').attr('fill-opacity', .75)
        .on('click', () => onSelect(rain.startSlot))
        .append('title').text(`${rainLabel}: ${rain.startLabel}–${rain.endLabel}`);
    }
    chart.append('rect').attr('id', 'dp-chart-selected').attr('y', top).attr('height', height - top - bottom).attr('width', (width - left - right) / 48).attr('fill', 'var(--dp-blue)').attr('fill-opacity', .1);
    chart.append('circle').attr('id', 'dp-chart-dot').attr('r', 4).attr('fill', 'var(--dp-blue)');
    chart.append('rect').attr('class', 'dp-chart-hit').attr('x', left).attr('y', top).attr('width', width - left - right).attr('height', height - top - bottom).attr('fill', 'transparent')
      .on('pointerdown', function (event) { this.setPointerCapture?.(event.pointerId); selectFromChart(event); })
      .on('pointermove', function (event) { if (event.buttons === 1) selectFromChart(event); });
  }

  function selectFromChart(event) {
    onSelect(Math.max(0, Math.min(47, Math.floor(x.invert(d3.pointer(event, chart.node())[0])))));
  }

  function updateMarker() {
    if (!forecast || !markerScale || !x || !y) {
      map.select('#dp-map-fill').attr('r', 0); map.select('#dp-map-typical').attr('r', 0);
      return;
    }
    const volume = forecast.selectedDay[selected].volume;
    map.select('#dp-map-fill').attr('r', markerScale(volume));
    map.select('#dp-map-typical').attr('r', markerScale(forecast.typicalDay[selected].volume));
    chart.select('#dp-chart-selected').attr('x', x(selected));
    chart.select('#dp-chart-dot').attr('cx', x(selected + .5)).attr('cy', y(volume));
  }

  function draw() { drawMap(); drawChart(); updateMarker(); }
  new ResizeObserver(draw).observe(root);
  draw();
  return {
    async loadGeometry() {
      const response = await fetch(CONFIG.geometryUrl);
      if (!response.ok) throw new Error('Map geometry could not be loaded.');
      geometry = await response.json();
      // D3's spherical polygon winding differs from many GeoJSON producers.
      geometry.buildings.features.forEach(feature => {
        if (d3.geoArea(feature) > 2 * Math.PI) feature.geometry.coordinates.forEach(ring => ring.reverse());
      });
      draw();
    },
    setForecast(value) { forecast = value; draw(); },
    select(index) { selected = index; updateMarker(); },
  };
}
