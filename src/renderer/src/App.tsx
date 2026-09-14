import React from 'react'
import { Terminal } from 'lucide-react'

export const App: React.FC = () => {
  return (
    <div className="flex h-screen w-screen flex-col bg-slate-900 text-slate-100">
      <header className="flex h-10 items-center border-b border-slate-700 bg-slate-800 px-4">
        <div className="flex items-center gap-2 font-semibold">
          <Terminal className="h-5 w-5 text-sky-400" />
          <span>MultiSSH</span>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-sky-400">MultiSSH</h1>
          <p className="mt-2 text-slate-400">Modern SSH, SFTP and S3 Client</p>
        </div>
      </main>
    </div>
  )
}

export default App
