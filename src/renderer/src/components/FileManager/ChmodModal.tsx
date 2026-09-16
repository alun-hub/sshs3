import React, { useState, useEffect, useMemo } from 'react';
import { Shield, X, Loader2 } from 'lucide-react';
import type { FileEntry } from '@shared/types/storage';

interface ChmodModalProps {
  open: boolean;
  providerId: string;
  entries: FileEntry[];
  onClose: () => void;
  onSaved: () => void;
}

interface PermissionState {
  uR: boolean;
  uW: boolean;
  uX: boolean;
  gR: boolean;
  gW: boolean;
  gX: boolean;
  oR: boolean;
  oW: boolean;
  oX: boolean;
}

function parseOctalToState(octal: string): PermissionState {
  const digits = octal.replace(/^0+/, '').padStart(3, '0').slice(-3);
  const u = parseInt(digits[0], 10) || 0;
  const g = parseInt(digits[1], 10) || 0;
  const o = parseInt(digits[2], 10) || 0;

  return {
    uR: (u & 4) !== 0,
    uW: (u & 2) !== 0,
    uX: (u & 1) !== 0,
    gR: (g & 4) !== 0,
    gW: (g & 2) !== 0,
    gX: (g & 1) !== 0,
    oR: (o & 4) !== 0,
    oW: (o & 2) !== 0,
    oX: (o & 1) !== 0,
  };
}

function stateToOctal(state: PermissionState): string {
  const u = (state.uR ? 4 : 0) + (state.uW ? 2 : 0) + (state.uX ? 1 : 0);
  const g = (state.gR ? 4 : 0) + (state.gW ? 2 : 0) + (state.gX ? 1 : 0);
  const o = (state.oR ? 4 : 0) + (state.oW ? 2 : 0) + (state.oX ? 1 : 0);
  return `0${u}${g}${o}`;
}

export const ChmodModal: React.FC<ChmodModalProps> = ({
  open,
  providerId,
  entries,
  onClose,
  onSaved,
}) => {
  const [octal, setOctal] = useState('0755');
  const [perms, setPerms] = useState<PermissionState>(() => parseOctalToState('0755'));
  const [recursive, setRecursive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasDirectory = useMemo(() => entries.some((e) => e.isDirectory), [entries]);

  useEffect(() => {
    if (open && entries.length > 0) {
      const initialPerm = entries[0].permissions || (entries[0].isDirectory ? '755' : '644');
      const normalized = initialPerm.length === 3 ? `0${initialPerm}` : initialPerm;
      setOctal(normalized);
      setPerms(parseOctalToState(normalized));
      setRecursive(false);
      setError(null);
    }
  }, [open, entries]);

  if (!open) return null;

  const handleOctalChange = (val: string) => {
    // Clean to numeric characters only, max 4 digits
    const cleaned = val.replace(/[^0-7]/g, '').slice(0, 4);
    setOctal(cleaned);
    if (cleaned.length >= 3) {
      setPerms(parseOctalToState(cleaned));
    }
  };

  const handleToggle = (key: keyof PermissionState) => {
    setPerms((prev) => {
      const updated = { ...prev, [key]: !prev[key] };
      setOctal(stateToOctal(updated));
      return updated;
    });
  };

  const applyRecursiveChmod = async (remotePath: string, modeStr: string) => {
    await window.multissh.storageChmod(providerId, remotePath, modeStr);
    try {
      const children = await window.multissh.storageList(providerId, remotePath);
      for (const child of children) {
        if (child.isDirectory) {
          await applyRecursiveChmod(child.path, modeStr);
        } else {
          await window.multissh.storageChmod(providerId, child.path, modeStr);
        }
      }
    } catch {
      // Ignore directory listing failures if unreadable
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const modeStr = octal.length === 3 ? `0${octal}` : octal;
      for (const entry of entries) {
        if (recursive && entry.isDirectory) {
          await applyRecursiveChmod(entry.path, modeStr);
        } else {
          await window.multissh.storageChmod(providerId, entry.path, modeStr);
        }
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte ändra filrättigheter');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-800/80 px-4 py-3">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-100">Ändra rättigheter (chmod)</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-xs text-slate-300">
          {/* File summary */}
          <div className="rounded border border-slate-800 bg-slate-950 p-2.5">
            <div className="text-[11px] text-slate-400 uppercase tracking-wider font-medium">Mål</div>
            <div className="mt-1 font-mono text-xs text-slate-200 truncate">
              {entries.length === 1 ? entries[0].name : `${entries.length} markerade objekt`}
            </div>
          </div>

          {/* Permissions Matrix */}
          <div className="rounded border border-slate-800 bg-slate-950/60 p-3">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] text-slate-400 uppercase tracking-wider">
                  <th className="pb-2 font-medium">Behörighet</th>
                  <th className="pb-2 text-center font-medium">Läsa (r)</th>
                  <th className="pb-2 text-center font-medium">Skriva (w)</th>
                  <th className="pb-2 text-center font-medium">Köra (x)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40 font-medium">
                <tr>
                  <td className="py-2 text-slate-200">Ägare (User)</td>
                  <td className="py-2 text-center">
                    <input
                      type="checkbox"
                      checked={perms.uR}
                      onChange={() => handleToggle('uR')}
                      className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500"
                    />
                  </td>
                  <td className="py-2 text-center">
                    <input
                      type="checkbox"
                      checked={perms.uW}
                      onChange={() => handleToggle('uW')}
                      className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500"
                    />
                  </td>
                  <td className="py-2 text-center">
                    <input
                      type="checkbox"
                      checked={perms.uX}
                      onChange={() => handleToggle('uX')}
                      className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500"
                    />
                  </td>
                </tr>
                <tr>
                  <td className="py-2 text-slate-200">Grupp (Group)</td>
                  <td className="py-2 text-center">
                    <input
                      type="checkbox"
                      checked={perms.gR}
                      onChange={() => handleToggle('gR')}
                      className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500"
                    />
                  </td>
                  <td className="py-2 text-center">
                    <input
                      type="checkbox"
                      checked={perms.gW}
                      onChange={() => handleToggle('gW')}
                      className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500"
                    />
                  </td>
                  <td className="py-2 text-center">
                    <input
                      type="checkbox"
                      checked={perms.gX}
                      onChange={() => handleToggle('gX')}
                      className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500"
                    />
                  </td>
                </tr>
                <tr>
                  <td className="py-2 text-slate-200">Övriga (Others)</td>
                  <td className="py-2 text-center">
                    <input
                      type="checkbox"
                      checked={perms.oR}
                      onChange={() => handleToggle('oR')}
                      className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500"
                    />
                  </td>
                  <td className="py-2 text-center">
                    <input
                      type="checkbox"
                      checked={perms.oW}
                      onChange={() => handleToggle('oW')}
                      className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500"
                    />
                  </td>
                  <td className="py-2 text-center">
                    <input
                      type="checkbox"
                      checked={perms.oX}
                      onChange={() => handleToggle('oX')}
                      className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Numeric octal representation */}
          <div className="flex items-center gap-3">
            <label className="text-xs text-slate-300 font-medium">Oktalt värde:</label>
            <input
              type="text"
              value={octal}
              onChange={(e) => handleOctalChange(e.target.value)}
              className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm text-center text-sky-400 focus:border-sky-500 focus:outline-none"
            />
          </div>

          {/* Recursive checkbox for directories */}
          {hasDirectory && (
            <label className="flex items-center gap-2 cursor-pointer text-slate-300">
              <input
                type="checkbox"
                checked={recursive}
                onChange={(e) => setRecursive(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500"
              />
              <span>Tillämpa rekursivt på underliggande filer och mappar</span>
            </label>
          )}

          {error && (
            <div className="rounded border border-red-800/80 bg-red-950/60 p-2 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-800 bg-slate-800/50 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
          >
            Avbryt
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Spara
          </button>
        </div>
      </div>
    </div>
  );
};
export default ChmodModal;
