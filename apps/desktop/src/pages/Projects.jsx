import { useEffect, useMemo, useState } from 'react';
import { FolderOpen, Plus, Search, Archive, ExternalLink, AlertTriangle } from 'lucide-react';
import { ENGINE_KEYS, ENGINES } from '@ember/shared/engines';
import { useApp } from '../lib/store.jsx';
import { bridge, isDesktop } from '../lib/bridge.js';
import { ConfirmDialog, Empty } from '../components/common.jsx';

/**
 * Projects Vault: every recently connected project, with real per-project
 * status pulled live from its own ember.config.json and stored reports —
 * no backend project-switch required, no fabricated numbers.
 */
function ProjectCard({ path, info, active, onOpen, onArchive }) {
  const loading = info === undefined;
  const notFound = info === null;

  if (loading) {
    return (
      <div className="proj-card skeleton">
        <div className="sk-line" style={{ width: '60%' }} />
        <div className="sk-line" style={{ width: '35%' }} />
        <div className="sk-line" style={{ width: '80%', marginTop: 14 }} />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="proj-card err">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={14} color="var(--err)" />
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Not found</span>
        </div>
        <div className="micro-mono" style={{ marginTop: 8, fontSize: 10, wordBreak: 'break-all' }}>{path}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 8 }}>Folder moved, renamed or deleted.</div>
        <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 12 }} onClick={onArchive}><Archive size={12} /> Remove from list</button>
      </div>
    );
  }

  const engine = ENGINES[info.config?.engine]?.label ?? info.config?.engine ?? 'custom';
  const lastReport = info.reports?.[info.reports.length - 1] ?? null;
  const bugsOpen = lastReport?.bugs ?? null;
  const rr = lastReport?.releaseReadiness;

  return (
    <div className={`proj-card ${active ? 'active' : ''}`}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div className="proj-ic"><FolderOpen size={16} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info.config?.projectName ?? 'Untitled project'}</div>
          <div className="micro-mono" style={{ fontSize: 9.5, color: 'var(--ink-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{path}</div>
        </div>
        {active && <span className="chip ok" style={{ fontSize: 8.5 }}>active</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        <span className="chip fire" style={{ fontSize: 8.5 }}>{engine}</span>
        {rr && <span className={`chip ${{ ready: 'ok', 'needs-fixes': 'warn', risky: 'err' }[rr.band]}`} style={{ fontSize: 8.5 }}>{rr.score}/100</span>}
        {bugsOpen !== null && <span className="chip dim" style={{ fontSize: 8.5 }}>{bugsOpen} issue(s)</span>}
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 10 }}>
        {lastReport ? `Last report ${new Date(lastReport.generatedAt).toLocaleDateString()}` : 'No report yet'}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button className="btn btn-white btn-sm" style={{ flex: 1 }} onClick={onOpen}><ExternalLink size={12} /> Open</button>
        <button className="btn btn-ghost btn-sm" onClick={onArchive}><Archive size={12} /></button>
      </div>
    </div>
  );
}

export default function Projects() {
  const { settings, saveSettings, project, connectProject, setModule, toast } = useApp();
  const [infoByPath, setInfoByPath] = useState({});
  const [search, setSearch] = useState('');
  const [engineFilter, setEngineFilter] = useState('all');
  const [archiving, setArchiving] = useState(null); // path pending confirm
  const [busy, setBusy] = useState(false);

  const paths = settings.recentProjects ?? [];

  useEffect(() => {
    let alive = true;
    (async () => {
      for (const p of paths) {
        if (infoByPath[p] !== undefined) continue;
        if (!isDesktop) { setInfoByPath((m) => ({ ...m, [p]: null })); continue; }
        try {
          const loaded = await bridge.config.load(p);
          if (!loaded?.config) { if (alive) setInfoByPath((m) => ({ ...m, [p]: null })); continue; }
          const reports = await bridge.agent.listReports(p).catch(() => []);
          if (alive) setInfoByPath((m) => ({ ...m, [p]: { config: loaded.config, reports } }));
        } catch {
          if (alive) setInfoByPath((m) => ({ ...m, [p]: null }));
        }
      }
    })();
    return () => { alive = false; };
  }, [paths.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    return paths.filter((p) => {
      const info = infoByPath[p];
      if (engineFilter !== 'all' && info?.config?.engine !== engineFilter) return false;
      if (search && !(info?.config?.projectName ?? p).toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [paths, infoByPath, engineFilter, search]);

  const addProject = async () => {
    if (!isDesktop) return toast('Native folder picker requires the Ember Desktop shell');
    const dir = await bridge.selectFolder('Select your game project folder');
    if (!dir) return;
    setBusy(true);
    const res = await connectProject(dir);
    setBusy(false);
    if (res?.needsInit) { setModule('connect'); toast('No ember.config.json there yet — finish setup in Connect'); }
    else setModule('command');
  };

  const openProject = async (p) => {
    if (p === project?.root) return setModule('command');
    setBusy(true);
    const res = await connectProject(p);
    setBusy(false);
    if (res?.needsInit) { setModule('connect'); return; }
    setModule('command');
  };

  const confirmArchive = async () => {
    setBusy(true);
    await saveSettings({ recentProjects: paths.filter((x) => x !== archiving) });
    setInfoByPath((m) => { const n = { ...m }; delete n[archiving]; return n; });
    setBusy(false);
    toast('Project archived from the vault');
    setArchiving(null);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '6px 0 18px' }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: '-.02em' }}>Projects</h2>
        <span className="micro-mono">{paths.length} in vault</span>
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-faint)' }} />
          <input className="input" style={{ width: 200, paddingLeft: 32 }} placeholder="Search projects…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input" style={{ width: 140 }} value={engineFilter} onChange={(e) => setEngineFilter(e.target.value)}>
          <option value="all">All engines</option>
          {ENGINE_KEYS.map((k) => <option key={k} value={k}>{ENGINES[k].label}</option>)}
        </select>
        <button className="btn btn-fire" disabled={busy} onClick={addProject}><Plus size={14} /> Add project</button>
      </div>

      {paths.length === 0 ? (
        <Empty icon={FolderOpen} title="No projects yet" body="Connect your first game project to start scanning, analyzing and testing it with Ember.">
          <button className="btn btn-white" onClick={addProject}>Add project</button>
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty icon={Search} title="No matches" body="No project matches this search or filter." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 12 }}>
          {filtered.map((p) => (
            <ProjectCard
              key={p}
              path={p}
              info={infoByPath[p]}
              active={p === project?.root}
              onOpen={() => openProject(p)}
              onArchive={() => setArchiving(p)}
            />
          ))}
        </div>
      )}

      {archiving && (
        <ConfirmDialog
          title="Archive this project?"
          body={`"${archiving}" will be removed from your Projects vault. Its files and .ember data on disk are untouched — you can reconnect it anytime with Add project.`}
          confirmLabel="Archive"
          busy={busy}
          onConfirm={confirmArchive}
          onCancel={() => setArchiving(null)}
        />
      )}
    </div>
  );
}
