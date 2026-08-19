import React, { useState, useEffect, useRef } from 'react';
import { FileText } from 'lucide-react';
import Vector from '../../imports/Vector/index';

interface TopHeaderProps {
  right?: React.ReactNode;
  /** Name of the file currently open in the editor. */
  fileName?: string;
  /** Commit a new name. Called on blur or Enter, never on every keystroke. */
  onRenameFile?: (name: string) => void;
}

/** Inline, click-to-edit file name. Blank input falls back to "Untitled". */
function FileNameField({ value, onCommit }: { value: string; onCommit: (n: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Track external renames (loading a file, New File) while not mid-edit.
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim() || 'Untitled';
    setDraft(next);
    if (next !== value) onCommit(next);
  };

  return (
    <input
      ref={inputRef}
      value={draft}
      title="Click to rename this file"
      spellCheck={false}
      onChange={e => setDraft(e.target.value)}
      onFocus={() => setEditing(true)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.currentTarget.blur(); }
        if (e.key === 'Escape') { setDraft(value); setEditing(false); e.currentTarget.blur(); }
      }}
      className="w-40 px-2 py-1 text-[11px] font-medium text-foreground bg-transparent border border-transparent rounded-md
                 hover:border-border hover:bg-secondary/50
                 focus:outline-none focus:border-primary focus:bg-background
                 transition-colors truncate"
    />
  );
}

export function TopHeader({ right, fileName, onRenameFile }: TopHeaderProps) {
  return (
    <header style={{
      position: 'fixed', top: 0, left: 0, width: '100%', height: 48,
      background: '#ffffff', borderBottom: '1px solid rgba(61,94,245,0.12)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 16px', zIndex: 100, boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <div style={{ width: 61, height: 22, flexShrink: 0 }}>
          <Vector />
        </div>
        {fileName !== undefined && onRenameFile && (
          <>
            <span style={{ color: 'rgba(61,94,245,0.25)', fontSize: 14, flexShrink: 0 }}>/</span>
            <div className="flex items-center gap-1.5 min-w-0">
              <FileText size={13} className="text-primary/60 flex-shrink-0" />
              <FileNameField value={fileName} onCommit={onRenameFile} />
            </div>
          </>
        )}
      </div>
      {right && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{right}</div>}
    </header>
  );
}
