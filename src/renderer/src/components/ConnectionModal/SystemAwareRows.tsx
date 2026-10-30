import React from 'react';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { groupBySystem, type SystemProfile } from '../../lib/systemGrouping';

interface SystemAwareRowsProps<T extends SystemProfile> {
  /** The profiles of one folder (or the ungrouped ones). */
  profiles: T[];
  /** 'personal' or a Team Vault id: told to `onConnectSystem`, and keeps collapse state of the same system name apart. */
  source: string;
  renderProfile: (profile: T) => React.ReactNode;
  /** Connects to every server of a system. Omit where that is not offered: the button is left out. */
  onConnectSystem?: (members: T[], source: string) => void;
  /** Collapsed systems, by `sys-<source>-<name in lower case>`. */
  collapsed: Record<string, boolean>;
  onToggle: (key: string) => void;
}

const ROW =
  'flex items-center gap-2 rounded-lg border border-border-subtle bg-app-surface-subtle px-2 py-1.5 transition-colors hover:border-border-strong';

/**
 * The profiles of a folder with the ones that form a system drawn as one row (name, number of
 * servers, "Connect all") with their servers indented below it, and the rest as before.
 */
export function SystemAwareRows<T extends SystemProfile>({
  profiles,
  source,
  renderProfile,
  onConnectSystem,
  collapsed,
  onToggle,
}: SystemAwareRowsProps<T>): React.ReactElement | null {
  const { systems, loose } = groupBySystem(profiles);
  if (systems.length === 0 && loose.length === 0) return null;
  return (
    <>
      {systems.map((system) => {
        const key = `sys-${source}-${system.name.toLowerCase()}`;
        const isCollapsed = Boolean(collapsed[key]);
        const count = system.members.length;
        return (
          <div key={key} className="flex flex-col gap-1.5">
            <div className={ROW}>
              <button
                type="button"
                aria-expanded={!isCollapsed}
                aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${system.name}`}
                onClick={() => onToggle(key)}
                className="shrink-0 rounded p-0.5 text-txt-muted hover:text-txt-primary"
              >
                {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
              </button>
              <Layers className="h-3.5 w-3.5 shrink-0 text-sky-400" aria-hidden="true" />
              <span className="min-w-0 truncate text-sm font-semibold text-txt-primary">{system.name}</span>
              <span className="shrink-0 text-xs text-txt-muted">{`${count} server${count === 1 ? '' : 's'}`}</span>
              <span className="flex-1" />
              {onConnectSystem && (
                <button
                  type="button"
                  aria-label={`Connect all servers in ${system.name}`}
                  onClick={() => onConnectSystem(system.members, source)}
                  className="shrink-0 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white shadow-sm transition-colors hover:bg-emerald-500"
                >
                  Connect all
                </button>
              )}
            </div>
            {!isCollapsed && (
              <div role="group" aria-label={system.name} className="ml-4 flex flex-col gap-1.5 border-l border-border-subtle pl-3">
                {system.members.map((member) => renderProfile(member))}
              </div>
            )}
          </div>
        );
      })}
      {loose.map((profile) => renderProfile(profile))}
    </>
  );
}
