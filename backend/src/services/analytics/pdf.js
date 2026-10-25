const PDFDocument = require('pdfkit');

const COLORS = { ink: '#1f2937', muted: '#6b7280', line: '#d1d5db', brand: '#4f46e5', bar: '#6366f1', bg: '#f3f4f6' };
const label = (v) => { if (v === 'sos') return 'SOS'; const s = String(v ?? '-').replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };
const fmtMin = (m) => (m == null ? '-' : m < 60 ? `${m} min` : `${(m / 60).toFixed(1)} h`);
const fmtDate = (iso) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

function barChart(doc, title, data, { x, y, w }) {
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(11).text(title, x, y);
  let cy = y + 18;
  if (!data.length || data.every((d) => !d.value)) {
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text('No data in this period.', x, cy);
    return cy + 22;
  }
  const max = Math.max(...data.map((d) => d.value), 1);
  const labelW = 120; const barMax = w - labelW - 40;
  data.slice(0, 8).forEach((d) => {
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.ink).text(d.label, x, cy + 1, { width: labelW - 6, ellipsis: true, lineBreak: false });
    const bw = Math.max(1, (d.value / max) * barMax);
    doc.rect(x + labelW, cy, bw, 11).fill(COLORS.bar);
    doc.fillColor(COLORS.ink).text(String(d.value), x + labelW + bw + 5, cy + 1, { lineBreak: false });
    cy += 16;
  });
  return cy + 8;
}

/** Vertical trend chart (one column per time bucket). */
function trendChart(doc, buckets, { x, y, w, h }) {
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(11).text('Incident trend', x, y);
  const top = y + 20; const base = top + h;
  doc.moveTo(x, base).lineTo(x + w, base).strokeColor(COLORS.line).lineWidth(0.7).stroke();
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const step = w / Math.max(buckets.length, 1);
  buckets.forEach((b, i) => {
    const bh = (b.count / max) * (h - 4);
    if (b.count) doc.rect(x + i * step + step * 0.15, base - bh, step * 0.7, bh).fill(COLORS.bar);
    if (buckets.length <= 14 || i % Math.ceil(buckets.length / 10) === 0) {
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7).text(b.label, x + i * step - 4, base + 3, { width: step + 8, align: 'center', lineBreak: false });
    }
  });
  doc.fillColor(COLORS.muted).fontSize(7).text(`peak ${max}`, x, top - 2, { lineBreak: false });
  return base + 22;
}

/** Streams a formatted A4 report for the given report object (see services/analytics/report.js). */
function renderReportPdf(report, res, { generatedBy } = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: 'STS analytics report', Author: 'Smart Tourist Safety System' } });
  doc.pipe(res);
  const left = 40; const width = doc.page.width - 80;
  const { summary: s, comparison: c, filters: f } = report;

  doc.rect(0, 0, doc.page.width, 70).fill(COLORS.brand);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(18).text('Smart Tourist Safety System', left, 20);
  doc.font('Helvetica').fontSize(11).text('Incident analytics report', left, 44);

  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(11).text('Period', left, 86);
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.ink)
    .text(`${fmtDate(report.range.from)}  to  ${fmtDate(report.range.to)}  (${report.range.preset === 'custom' ? 'custom range' : `last ${report.range.preset}`})`, left, 101);
  const filterBits = [
    f.type.length && `type: ${f.type.map(label).join(', ')}`, f.severity.length && `severity: ${f.severity.map(label).join(', ')}`,
    f.status.length && `status: ${f.status.map(label).join(', ')}`, f.touristName && `tourist: ${f.touristName}`,
    f.area && `area: ${f.area.radiusKm} km around ${f.area.lat.toFixed(4)}, ${f.area.lng.toFixed(4)}`,
  ].filter(Boolean);
  doc.fillColor(COLORS.muted).fontSize(9).text(`Filters: ${filterBits.length ? filterBits.join(' · ') : 'none'}`, left, 117);

  // summary cards
  const cards = [
    ['Total incidents', s.totalIncidents], ['Active SOS now', s.activeSos], ['Resolved', s.resolvedIncidents],
    ['Geofence violations', s.geofenceViolations], ['Avg response', fmtMin(s.avgResponseMin)],
  ];
  const cw = (width - 4 * 8) / 5; let cy = 140;
  cards.forEach(([k, v], i) => {
    const cx = left + i * (cw + 8);
    doc.roundedRect(cx, cy, cw, 52, 4).fill(COLORS.bg);
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(16).text(String(v), cx + 8, cy + 9, { width: cw - 16, lineBreak: false });
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8).text(k, cx + 8, cy + 34, { width: cw - 16, lineBreak: false });
  });
  cy += 68;

  // comparison
  const chg = (v) => (v == null ? 'n/a' : `${v > 0 ? '+' : ''}${v}%`);
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(11).text('Compared with the previous period', left, cy);
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.ink).text(
    `Incidents ${s.totalIncidents} vs ${c.previous.totalIncidents} (${chg(c.changePct.totalIncidents)})  ·  Resolved ${s.resolvedIncidents} vs ${c.previous.resolvedIncidents} (${chg(c.changePct.resolvedIncidents)})  ·  ` +
    `Violations ${s.geofenceViolations} vs ${c.previous.geofenceViolations} (${chg(c.changePct.geofenceViolations)})  ·  Avg response ${fmtMin(s.avgResponseMin)} vs ${fmtMin(c.previous.avgResponseMin)}`,
    left, cy + 16, { width },
  );
  cy += 52;

  cy = trendChart(doc, report.trend.buckets, { x: left, y: cy, w: width, h: 90 });
  cy = barChart(doc, 'Severity distribution', report.severity.map((d) => ({ label: label(d.key), value: d.count })), { x: left, y: cy + 8, w: width });
  cy = barChart(doc, 'Incident categories', report.categories.map((d) => ({ label: label(d.key), value: d.count })), { x: left, y: cy + 4, w: width });

  if (cy > 640) { doc.addPage(); cy = 40; }
  cy = barChart(doc, 'Zone violations', report.zoneViolations.map((d) => ({ label: `${d.zone} (${label(d.type)})`, value: d.entries })), { x: left, y: cy + 4, w: width });

  if (cy > 660) { doc.addPage(); cy = 40; }
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(11).text('Response and resolution times', left, cy + 4);
  const rt = report.responseTimes;
  doc.font('Helvetica').fontSize(9).text(
    `Time to acknowledge: average ${fmtMin(rt.acknowledge.avg)}, median ${fmtMin(rt.acknowledge.median)} (${rt.acknowledge.n} incidents)`, left, cy + 22);
  doc.text(`Time to resolve: average ${fmtMin(rt.resolve.avg)}, median ${fmtMin(rt.resolve.median)} (${rt.resolve.n} incidents)`, left, cy + 36);
  doc.text(`Escalated: ${s.escalatedIncidents}   ·   Overdue now: ${s.overdueIncidents}   ·   Still active: ${s.activeIncidents}`, left, cy + 50);

  doc.fillColor(COLORS.muted).fontSize(8).text(
    `Generated ${fmtDate(new Date().toISOString())}${generatedBy ? ` by ${generatedBy}` : ''} from the live database. Times are measured from each incident's original creation time.`,
    left, doc.page.height - 50, { width, align: 'center' },
  );
  doc.end();
}

module.exports = { renderReportPdf };
