import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Menu, X, Plus, Trash2, FileText, Check, Clock, Save } from 'lucide-react';

export interface CanvasState {
  dots: unknown[]; gridSize: number; dotColor: string; bgColor: string;
  spread: number; crispness: number; outlineMode: boolean; outlineWeight: number; clusterMode: string;
  // Optional so files saved by older builds still load.
  customLayers?: unknown[];
  roughness?: number; shadowOpacity?: number; shadowBlur?: number;
  showGrid?: boolean; dotShape?: string;
}

export interface DotletFile {
  id: string; name: string; updatedAt: string | null; canvas: CanvasState | null;
}

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'idle';

interface Props {
  currentFileId: string | null; saveStatus: SaveStatus;
  onLoad: (f: DotletFile) => void; onNew: () => void;
  onSaveNow: () => Promise<void>;
  /** Called when the file currently open in the editor is deleted. */
  onCurrentDeleted?: () => void;
  /** Called when the file currently open in the editor is renamed from here. */
  onCurrentRenamed?: (name: string) => void;
}

function ago(iso: string | null) {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function SaveButton({ status, onSave }: { status: SaveStatus; onSave: () => void }) {
  return (
    <button onClick={onSave} title="Save (Cmd+S)"
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
        status === 'saved' ? 'text-green-600 bg-green-50 hover:bg-green-100'
        : status === 'saving' ? 'text-yellow-600 bg-yellow-50 cursor-wait'
        : status === 'unsaved' ? 'text-primary bg-primary/10 hover:bg-primary/20'
        : 'text-muted-foreground bg-secondary hover:bg-secondary/70'
      }`}>
      {status === 'saving' ? <Clock size={12} /> : status === 'saved' ? <Check size={12} /> : <Save size={12} />}
      {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'unsaved' ? 'Save' : 'Save'}
    </button>
  );
}

export function FileManager({ currentFileId, saveStatus, onLoad, onNew, onSaveNow, onCurrentDeleted, onCurrentRenamed }: Props) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<DotletFile[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const fetchFiles = useCallback(() => {
    try {
      const stored = localStorage.getItem('dotlet_files');
      if (stored) {
        setFiles(JSON.parse(stored));
      } else {
        setFiles([]);
      }
    } catch (e) {
      console.error('Failed to parse files from local storage', e);
      setFiles([]);
    }
  }, []);

  useEffect(() => { if (open) fetchFiles(); }, [open, fetchFiles]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  // Re-read from storage before writing: autosave writes the same key on a timer,
  // so persisting a mutation of this component's (possibly stale) `files` state
  // would silently roll back whatever autosave just stored.
  const writeFiles = (mutate: (current: DotletFile[]) => DotletFile[]) => {
    let current: DotletFile[] = [];
    try {
      const stored = localStorage.getItem('dotlet_files');
      current = stored ? JSON.parse(stored) : [];
    } catch { current = files; }
    const updated = mutate(current);
    setFiles(updated);
    try {
      localStorage.setItem('dotlet_files', JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to write files to local storage', e);
    }
  };

  const commitRename = (id: string) => {
    const name = editName.trim() || 'Untitled';
    writeFiles(cur => cur.map(f => f.id === id ? { ...f, name } : f));
    setEditingId(null);
    // Keep the header's name field in sync when it's the open file.
    if (id === currentFileId) onCurrentRenamed?.(name);
  };

  const deleteFile = (id: string) => {
    writeFiles(cur => cur.filter(f => f.id !== id));
    setDeleteId(null);
    // Without this the editor keeps the deleted id and autosave re-creates the file.
    if (id === currentFileId) onCurrentDeleted?.();
  };

  return (
    <div ref={drawerRef} className="relative">
      <button onClick={() => setOpen(o => !o)} title="Files"
        className="flex items-center justify-center w-8 h-8 rounded-lg text-foreground hover:bg-secondary transition-colors">
        {open ? <X size={16} /> : <Menu size={16} />}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-72 bg-white border border-border rounded-2xl shadow-2xl z-[100] overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground truncate">Local Storage</p>
            {saveStatus !== 'idle' && (
              <span className={`text-[10px] flex items-center gap-1 ${saveStatus === 'saved' ? 'text-green-600' : saveStatus === 'saving' ? 'text-yellow-600' : 'text-orange-500'}`}>
                {saveStatus === 'saved' ? <><Check size={10} />Saved</> : saveStatus === 'saving' ? <><Clock size={10} />Saving…</> : 'Unsaved changes'}
              </span>
            )}
          </div>

          <div className="flex gap-2 p-3 border-b border-border">
            <button onClick={() => { onNew(); setOpen(false); }}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
              <Plus size={12} /> New File
            </button>
            <button onClick={onSaveNow}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] bg-secondary text-foreground hover:bg-secondary/70 transition-colors">
              <Save size={12} /> Save Now
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {files.length === 0 && <p className="text-[11px] text-muted-foreground text-center py-6">No saved files yet</p>}
            {files.map(f => (
              <div key={f.id} className={`group flex items-center gap-2 px-4 py-2.5 hover:bg-muted/40 cursor-pointer transition-colors ${f.id === currentFileId ? 'bg-primary/5 border-l-2 border-primary' : ''}`}>
                <FileText size={13} className="text-muted-foreground flex-shrink-0" />
                {editingId === f.id ? (
                  <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                    onBlur={() => commitRename(f.id)}
                    onKeyDown={e => { if (e.key === 'Enter') commitRename(f.id); if (e.key === 'Escape') setEditingId(null); }}
                    className="flex-1 text-[11px] border-b border-primary focus:outline-none bg-transparent"
                    onClick={e => e.stopPropagation()} />
                ) : (
                  <div className="flex-1 min-w-0" onClick={() => { onLoad(f); setOpen(false); }} onDoubleClick={() => { setEditingId(f.id); setEditName(f.name); }}>
                    <p className="text-[11px] font-medium text-foreground truncate">{f.name}</p>
                    <p className="text-[10px] text-muted-foreground">{ago(f.updatedAt)}</p>
                  </div>
                )}
                {deleteId === f.id ? (
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={e => { e.stopPropagation(); deleteFile(f.id); }} className="text-[10px] text-red-500 px-1.5 py-0.5 rounded bg-red-50 hover:bg-red-100">Delete</button>
                    <button onClick={e => { e.stopPropagation(); setDeleteId(null); }} className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted">Cancel</button>
                  </div>
                ) : (
                  <button onClick={e => { e.stopPropagation(); setDeleteId(f.id); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-500 p-1 flex-shrink-0">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
