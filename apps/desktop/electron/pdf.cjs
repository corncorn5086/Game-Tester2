/**
 * Renders a real Ember QA report to PDF bytes with pdfkit. Runs in the
 * Electron main process (Node context) — the renderer never touches pdfkit
 * directly, it just asks for bytes over IPC. Every section is built strictly
 * from the report object already produced by @ember/agent; nothing here
 * invents data that isn't in the report.
 */
const PDFDocument = require('pdfkit');
const { existsSync } = require('node:fs');

const INK = '#18181b';
const DIM = '#52525b';
const FAINT = '#8b8b94';
const FIRE = '#ff5a1f';
const SEV_COLOR = { critical: '#ef4444', high: '#fb923c', medium: '#fbbf24', low: '#93c5fd' };
const BAND_COLOR = { ready: '#22c55e', 'needs-fixes': '#f59e0b', risky: '#ef4444' };

function h(doc, text, size = 14) {
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(size).text(text);
}
function p(doc, text, opts = {}) {
  doc.fillColor(DIM).font('Helvetica').fontSize(9.5).text(text, opts);
}
function ensureSpace(doc, needed) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function buildReportPdf(report, { logoPath } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // --- header ---
    if (logoPath && existsSync(logoPath)) {
      try { doc.image(logoPath, doc.page.margins.left, doc.y, { width: 28 }); } catch { /* logo optional */ }
    }
    doc.fontSize(20).font('Helvetica-Bold').fillColor(FIRE).text('Ember', doc.page.margins.left + 38, doc.y - (logoPath ? 24 : 0));
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica').fillColor(FAINT).text('Autonomous QA Report');
    doc.moveDown(1);

    const m = report.metrics ?? {};
    h(doc, report.project?.name ?? 'Untitled project', 16);
    p(doc, `${report.project?.engine ?? 'unknown engine'} · generated ${new Date(report.generatedAt).toLocaleString()}`);
    doc.moveDown(1);

    // --- release readiness ---
    const rr = report.releaseReadiness;
    if (rr) {
      ensureSpace(doc, 90);
      const color = BAND_COLOR[rr.band] ?? INK;
      doc.roundedRect(doc.page.margins.left, doc.y, doc.page.width - doc.page.margins.left - doc.page.margins.right, 70, 6).fillOpacity(0.06).fill(color).fillOpacity(1);
      const boxY = doc.y + 12;
      doc.fontSize(26).font('Helvetica-Bold').fillColor(color).text(`${rr.score}/100`, doc.page.margins.left + 16, boxY, { continued: false });
      doc.fontSize(11).font('Helvetica-Bold').fillColor(color).text(rr.bandLabel, doc.page.margins.left + 16, boxY + 32);
      doc.y = boxY + 70 - 12;
      doc.moveDown(1);

      if (rr.blocksRelease?.length) {
        h(doc, 'What blocks release', 10.5);
        rr.blocksRelease.forEach((b) => p(doc, `• ${b}`));
        doc.moveDown(0.5);
      }
      if (rr.deductions?.length) {
        h(doc, 'Score deductions', 10.5);
        rr.deductions.forEach((d) => p(doc, `−${d.points}  ${d.reason}`));
        doc.moveDown(0.5);
      }
    }

    // --- executive summary ---
    if (report.executiveSummary) {
      ensureSpace(doc, 40);
      h(doc, 'Executive Summary', 12);
      p(doc, report.executiveSummary, { align: 'justify' });
      doc.moveDown(1);
    }

    // --- metrics ---
    ensureSpace(doc, 60);
    h(doc, 'Metrics', 12);
    const metricLines = [
      `Files scanned: ${m.filesScanned ?? 0}  ·  Logs analyzed: ${m.logsAnalyzed ?? 0}  ·  Commands run: ${m.commandsExecuted ?? 0}`,
      `Crash risk: ${m.crashRisk ?? 'unknown'}  ·  Build health: ${m.buildHealth ?? 'unknown'}  ·  Regression risk: ${m.regressionRisk ?? 'unknown'}`,
      `Checks passed: ${m.passedChecks ?? 0}  ·  Failed: ${m.failedChecks ?? 0}  ·  Blocked (missing SDK): ${m.blockedChecks ?? 0}`
    ];
    metricLines.forEach((l) => p(doc, l));
    doc.moveDown(1);

    // --- bugs by severity (simple bar chart) ---
    const sb = m.severityBreakdown ?? { critical: 0, high: 0, medium: 0, low: 0 };
    const maxCount = Math.max(1, ...Object.values(sb));
    ensureSpace(doc, 100);
    h(doc, `Bugs by severity (${m.bugsFound ?? 0} total)`, 12);
    doc.moveDown(0.3);
    const chartX = doc.page.margins.left + 70;
    const chartW = doc.page.width - doc.page.margins.left - doc.page.margins.right - 70;
    for (const sev of ['critical', 'high', 'medium', 'low']) {
      const count = sb[sev] ?? 0;
      const barW = Math.max(2, (count / maxCount) * chartW);
      const y = doc.y;
      doc.fontSize(9).font('Helvetica').fillColor(DIM).text(sev, doc.page.margins.left, y + 2, { width: 62 });
      doc.rect(chartX, y, barW, 12).fill(SEV_COLOR[sev]);
      doc.fontSize(9).fillColor(INK).text(String(count), chartX + barW + 6, y + 2);
      doc.y = y + 18;
    }
    doc.moveDown(1);

    // --- top bugs with repro steps ---
    const bugs = (report.bugs ?? []).slice(0, 12);
    if (bugs.length) {
      ensureSpace(doc, 40);
      h(doc, 'Bugs', 12);
      doc.moveDown(0.3);
      for (const b of bugs) {
        ensureSpace(doc, 60);
        doc.fontSize(10.5).font('Helvetica-Bold').fillColor(SEV_COLOR[b.severity] ?? INK).text(`[${b.severity}] `, { continued: true });
        doc.fillColor(INK).text(b.title);
        doc.fontSize(9).font('Helvetica').fillColor(FAINT).text(`${b.category} · ${b.source}${b.filesInvolved?.length ? ` · ${b.filesInvolved.join(', ')}` : ''}`);
        if (b.evidence) p(doc, `Evidence: ${b.evidence}`);
        if (b.stepsToReproduce?.length) {
          p(doc, `Repro: ${b.stepsToReproduce.map((s, i) => `${i + 1}. ${s}`).join('  ')}`);
        }
        doc.moveDown(0.6);
      }
    }

    // --- recommendations ---
    if (report.recommendedNextActions?.length || rr?.risksIfShipped?.length) {
      ensureSpace(doc, 40);
      h(doc, 'Recommendations', 12);
      (report.recommendedNextActions ?? []).forEach((a) => p(doc, `• ${a}`));
      if (rr?.risksIfShipped?.length) {
        doc.moveDown(0.4);
        h(doc, 'Risks if you ship today', 10.5);
        rr.risksIfShipped.forEach((r) => p(doc, `• ${r}`));
      }
    }

    // --- footer page numbers ---
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.fontSize(8).fillColor(FAINT).text(
        `Ember QA Report · ${report.project?.name ?? ''} · page ${i + 1} of ${range.count}`,
        doc.page.margins.left, doc.page.height - 30,
        { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center' }
      );
    }

    doc.end();
  });
}

module.exports = { buildReportPdf };
