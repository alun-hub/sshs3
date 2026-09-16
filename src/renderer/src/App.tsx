import React, { useState } from 'react';
import { Terminal } from 'lucide-react';
import { TabBar, type TabItem, type TabType } from './components/TabBar';
import { TerminalView } from './components/TerminalView';
import { SmartcardPinModal } from './components/SmartcardPinModal';
import { HostKeyTrustModal } from './components/HostKeyTrustModal';
import { TransferConflictModal } from './components/TransferConflictModal';
import { DualPaneExplorer } from './components/FileManager/DualPaneExplorer';
import { ConnectionManagerModal } from './components/ConnectionModal/ConnectionManagerModal';
import type { SSHConnectionConfig } from '@shared/types/ssh';

export interface AppTab extends TabItem {
  config?: SSHConnectionConfig;
}

export const App: React.FC = () => {
  const [tabs, setTabs] = useState<AppTab[]>([
    {
      id: 'term-1',
      type: 'terminal',
      title: 'Terminal 1',
    },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('term-1');
  const [termCounter, setTermCounter] = useState(2);
  const [fmCounter, setFmCounter] = useState(1);
  const [profilesModalOpen, setProfilesModalOpen] = useState(false);
  const [connectTargetTabId, setConnectTargetTabId] = useState<string | null>(null);

  const handleSelectTab = (id: string) => {
    setActiveTabId(id);
  };

  const handleCloseTab = (id: string) => {
    setTabs((prev) => {
      const index = prev.findIndex((t) => t.id === id);
      const remaining = prev.filter((t) => t.id !== id);

      if (id === activeTabId && remaining.length > 0) {
        const nextIndex = Math.max(0, index - 1);
        setActiveTabId(remaining[nextIndex].id);
      }

      return remaining;
    });
  };

  const handleNewTab = (type: TabType) => {
    if (type === 'terminal') {
      const newId = `term-${Date.now()}`;
      const newTab: AppTab = {
        id: newId,
        type: 'terminal',
        title: `Terminal ${termCounter}`,
      };
      setTermCounter((c) => c + 1);
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newId);
    } else if (type === 'filemanager') {
      const newId = `fm-${Date.now()}`;
      const newTab: AppTab = {
        id: newId,
        type: 'filemanager',
        title: `Filhanterare ${fmCounter}`,
      };
      setFmCounter((c) => c + 1);
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newId);
    }
  };

  const handleConnectTerminal = (tabId: string, config: SSHConnectionConfig) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, config, title: config.name } : t)));
    setConnectTargetTabId(null);
  };

  const handleOpenProfiles = () => {
    setProfilesModalOpen(true);
  };

  const handleOpenSettings = () => {
    window.alert('Inställningar är inte implementerat ännu.');
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-900 text-slate-100 overflow-hidden select-none">
      {/* Top Bar with Brand & TabBar */}
      <header className="flex h-10 shrink-0 items-center border-b border-slate-700 bg-slate-800">
        <div className="flex items-center gap-2 border-r border-slate-700 px-3.5 font-semibold text-sm">
          <Terminal className="h-4 w-4 text-sky-400" />
          <span className="font-bold tracking-wide text-white">MultiSSH</span>
        </div>
        <div className="flex-1 min-w-0">
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            onNewTab={handleNewTab}
            onOpenProfiles={handleOpenProfiles}
            onOpenSettings={handleOpenSettings}
          />
        </div>
      </header>

      {/* Main Content Area: non-active tabs stay mounted with display: none */}
      <main className="relative flex flex-1 w-full overflow-hidden">
        {tabs.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center text-slate-500">
            <p className="text-sm">Inga öppna flikar</p>
            <button
              type="button"
              onClick={() => handleNewTab('terminal')}
              className="mt-3 rounded bg-sky-500/20 px-3 py-1.5 text-xs text-sky-400 hover:bg-sky-500/30"
            >
              Öppna ny terminal
            </button>
          </div>
        ) : (
          tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                data-testid={`tab-panel-${tab.id}`}
                className={`h-full w-full ${isActive ? 'flex flex-1 flex-col' : 'hidden'}`}
                style={{ display: isActive ? 'flex' : 'none', flexDirection: 'column' }}
              >
                {tab.type === 'terminal' ? (
                  tab.config ? (
                    <TerminalView config={tab.config} isActive={isActive} />
                  ) : (
                    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-900 text-slate-400">
                      <Terminal className="h-10 w-10 text-slate-600" />
                      <p className="text-sm">Ingen anslutning vald för den här fliken</p>
                      <button
                        type="button"
                        onClick={() => setConnectTargetTabId(tab.id)}
                        className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
                      >
                        Välj SSH-anslutning
                      </button>
                    </div>
                  )
                ) : (
                  <div data-testid={`filemanager-panel-${tab.id}`} className="flex min-h-0 flex-1 flex-col">
                    <DualPaneExplorer />
                  </div>
                )}
              </div>
            );
          })
        )}
      </main>

      {/* Global Smartcard PIN Modal */}
      <SmartcardPinModal />

      {/* Global SFTP host key trust-on-first-use dialog */}
      <HostKeyTrustModal />

      {/* Global transfer conflict (overwrite/skip/rename) dialog */}
      <TransferConflictModal />

      {/* Per-tab: pick an SSH profile to power an empty terminal tab */}
      <ConnectionManagerModal
        open={connectTargetTabId !== null}
        initialTab="ssh"
        onClose={() => setConnectTargetTabId(null)}
        onConnectSSH={(config) => {
          if (connectTargetTabId) handleConnectTerminal(connectTargetTabId, config);
        }}
      />

      {/* Quick-link: manage saved SSH/S3 profiles without connecting anything */}
      <ConnectionManagerModal open={profilesModalOpen} onClose={() => setProfilesModalOpen(false)} />
    </div>
  );
};

export default App;
