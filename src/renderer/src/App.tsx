import React, { useState } from 'react';
import { Terminal, Folder } from 'lucide-react';
import { TabBar, type TabItem, type TabType } from './components/TabBar';
import { TerminalView } from './components/TerminalView';
import { SmartcardPinModal } from './components/SmartcardPinModal';
import type { SSHConnectionConfig } from '@shared/types/ssh';

export interface AppTab extends TabItem {
  config?: SSHConnectionConfig;
}

const DEFAULT_SSH_CONFIG: SSHConnectionConfig = {
  id: 'default-session',
  name: 'Lokal terminal',
  host: 'localhost',
  port: 22,
  username: 'user',
  authType: 'password',
};

export const App: React.FC = () => {
  const [tabs, setTabs] = useState<AppTab[]>([
    {
      id: 'term-1',
      type: 'terminal',
      title: 'Terminal 1',
      config: DEFAULT_SSH_CONFIG,
    },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('term-1');
  const [termCounter, setTermCounter] = useState(2);
  const [fmCounter, setFmCounter] = useState(1);

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
        config: { ...DEFAULT_SSH_CONFIG, id: newId, name: `Terminal ${termCounter}` },
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

  const handleOpenProfiles = () => {
    console.log('Open profiles manager');
  };

  const handleOpenSettings = () => {
    console.log('Open settings');
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
                  <TerminalView
                    config={tab.config || DEFAULT_SSH_CONFIG}
                    isActive={isActive}
                  />
                ) : (
                  <div
                    data-testid={`filemanager-panel-${tab.id}`}
                    className="flex flex-1 flex-col items-center justify-center bg-slate-900 text-slate-400 p-8 select-none"
                  >
                    <div className="rounded-full bg-slate-800 p-4 mb-4 text-amber-400 shadow-inner">
                      <Folder className="h-10 w-10" />
                    </div>
                    <h3 className="text-base font-semibold text-slate-200">
                      Filhanterare (SFTP / S3 / Lokal)
                    </h3>
                    <p className="mt-1 text-sm text-slate-400 max-w-sm text-center">
                      Filsystem- och överföringsvy implementeras i Task 9.
                    </p>
                  </div>
                )}
              </div>
            );
          })
        )}
      </main>

      {/* Global Smartcard PIN Modal */}
      <SmartcardPinModal />
    </div>
  );
};

export default App;
