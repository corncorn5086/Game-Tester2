import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { maskSensitive } from './util.js';

/**
 * Local artifact store: .ember/ inside the project keeps run history and
 * reports so `ember report` and regression comparison work fully offline.
 */
export class LocalStore {
  constructor(root) {
    this.dir = join(root, '.ember');
  }

  ensure() {
    for (const sub of ['', 'runs', 'reports']) {
      const p = join(this.dir, sub);
      if (!existsSync(p)) mkdirSync(p, { recursive: true });
    }
  }

  saveRun(run) {
    this.ensure();
    const file = join(this.dir, 'runs', `run-${Date.now()}.json`);
    writeFileSync(file, JSON.stringify(maskSensitive(run), null, 2));
    return file;
  }

  saveReport(report) {
    this.ensure();
    const file = join(this.dir, 'reports', `${report.id}.json`);
    writeFileSync(file, JSON.stringify(maskSensitive(report), null, 2));
    return file;
  }

  latestReport() {
    const dir = join(this.dir, 'reports');
    if (!existsSync(dir)) return null;
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    if (!files.length) return null;
    try {
      return JSON.parse(readFileSync(join(dir, files[files.length - 1]), 'utf8'));
    } catch {
      return null;
    }
  }

  listReports() {
    const dir = join(this.dir, 'reports');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => {
        const file = join(dir, f);
        try {
          const r = JSON.parse(readFileSync(file, 'utf8'));
          if (!r || typeof r !== 'object' || Array.isArray(r)) {
            const invalidShape = new TypeError('Report JSON must contain an object.');
            invalidShape.code = 'REPORT_INVALID_SHAPE';
            throw invalidShape;
          }
          return { file, id: r.id, generatedAt: r.generatedAt, bugs: r.metrics?.bugsFound ?? 0, releaseReadiness: r.releaseReadiness ?? null };
        } catch (error) {
          // Keep the file visible to callers. The desktop bridge can then
          // surface a recoverable corrupt-report row instead of silently
          // making local history disappear.
          return {
            file,
            id: f.slice(0, -'.json'.length),
            generatedAt: null,
            bugs: 0,
            releaseReadiness: null,
            kind: 'corrupt-report',
            loadError: {
              code: 'REPORT_INVALID',
              message: 'The local report is unreadable or contains invalid JSON.',
              systemCode: error?.code ?? null
            }
          };
        }
      });
  }

  /**
   * Regression check: which bugs from the previous report are gone,
   * still present, or new in the current one (matched on stable identity).
   */
  compareReports(previous, current) {
    const key = (b) => `${b.source}:${b.ruleId ?? b.title}:${b.filesInvolved?.[0] ?? ''}`;
    const prevKeys = new Map((previous?.bugs ?? []).map((b) => [key(b), b]));
    const currKeys = new Map((current?.bugs ?? []).map((b) => [key(b), b]));
    return {
      fixed: [...prevKeys.entries()].filter(([k]) => !currKeys.has(k)).map(([, b]) => b),
      stillPresent: [...currKeys.entries()].filter(([k]) => prevKeys.has(k)).map(([, b]) => b),
      new: [...currKeys.entries()].filter(([k]) => !prevKeys.has(k)).map(([, b]) => b)
    };
  }
}
