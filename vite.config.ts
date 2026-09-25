/// <reference types="vitest" />
import { defineConfig } from 'vite'
import path from 'node:path'
import fs from 'node:fs'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

function copyProxyCliPlugin() {
  return {
    name: 'copy-proxy-cli',
    closeBundle() {
      const src = path.resolve(import.meta.dirname, 'src/main/proxy/proxyCli.cjs')
      const dest = path.resolve(import.meta.dirname, 'dist-electron/proxyCli.cjs')
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(src, dest)
      }
    },
  }
}

function copyCertWorkerPlugin() {
  return {
    name: 'copy-cert-worker',
    closeBundle() {
      const src = path.resolve(import.meta.dirname, 'src/main/smartcard/certWorker.cjs')
      const dest = path.resolve(import.meta.dirname, 'dist-electron/certWorker.cjs')
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(src, dest)
      }
    },
  }
}

function copyOcShimCliPlugin() {
  return {
    name: 'copy-oc-shim-cli',
    closeBundle() {
      const src = path.resolve(import.meta.dirname, 'src/main/services/ocShimCli.cjs')
      const dest = path.resolve(import.meta.dirname, 'dist-electron/ocShimCli.cjs')
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(src, dest)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    copyProxyCliPlugin(),
    copyCertWorkerPlugin(),
    copyOcShimCliPlugin(),
    electron({
      main: {
        entry: 'src/main/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rolldownOptions: {
              external: [
                'ssh2',
                'node-pty',
                'pkcs11js',
                'ssh2-sftp-client',
                '@aws-sdk/client-s3',
                '@aws-sdk/lib-storage',
              ],
            },
          },
        },
      },
      preload: {
        input: 'src/preload/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rolldownOptions: {
              output: {
                format: 'cjs',
                entryFileNames: '[name].cjs',
              },
            },
          },
        },
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/xterm') || id.includes('node_modules/@xterm')) {
            return 'xterm-bundle';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'icons-bundle';
          }
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react-vendor';
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src/renderer/src'),
      '@shared': path.resolve(import.meta.dirname, 'src/shared'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/release/**', '**/dist/**', '**/dist-electron/**'],
    },
  },
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
  },
})
