import { useEffect, useRef, useState } from 'react';
import { Globe, Check, ChevronDown } from 'lucide-react';
import { LANGUAGES } from '../lib/i18n.js';
import { useApp } from '../lib/store.jsx';

/**
 * Premium language picker. Changes the app language instantly and, when the
 * user is signed in, persists the choice to their account (users.language).
 * `variant="chip"` renders a compact top-right control; `variant="inline"`
 * renders a full-width list for the settings panel.
 */
export default function LanguageSelect({ variant = 'chip' }) {
  const { settings, saveSettings, api, user, refreshUser } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = LANGUAGES.find((l) => l.code === settings.language) ?? LANGUAGES[0];

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const choose = async (code) => {
    setOpen(false);
    if (code === settings.language) return;
    await saveSettings({ language: code });
    if (user && settings.authToken) {
      try { await api.updateProfile({ language: code }); await refreshUser(); } catch { /* offline: stays local */ }
    }
  };

  if (variant === 'inline') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8 }}>
        {LANGUAGES.map((l) => (
          <button key={l.code} onClick={() => choose(l.code)} className="lang-inline" data-on={l.code === settings.language}>
            <span style={{ flex: 1, textAlign: 'left' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{l.native}</span>
              <span style={{ display: 'block', fontSize: 10, color: 'var(--ink-faint)' }}>{l.name}</span>
            </span>
            {l.code === settings.language && <Check size={14} color="var(--accent-soft)" />}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="lang-chip" onClick={() => setOpen((o) => !o)}>
        <Globe size={14} />
        <span>{current.native}</span>
        <ChevronDown size={13} style={{ opacity: 0.6 }} />
      </button>
      {open && (
        <div className="lang-pop">
          {LANGUAGES.map((l) => (
            <button key={l.code} className="lang-opt" onClick={() => choose(l.code)}>
              <span style={{ flex: 1, textAlign: 'start' }}>{l.native}</span>
              <span style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{l.name}</span>
              {l.code === settings.language && <Check size={13} color="var(--accent-soft)" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
