import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import security from 'eslint-plugin-security';

// Size ratchet (project rule: files over ~800 lines must not grow; split them instead). Every source file
// currently over 800 lines has a ceiling just above its size today (rounded up to 25); every other source
// file is held to 800. Lower a ceiling when a file is split. Never raise one to make a build pass.
const MAX_LINES_DEFAULT = 800;
const LARGE_FILE_CEILINGS = {
  'src/main/services/TeamVaultService.ts': 1975,
  'src/main/IpcBridge.ts': 1950,
  'src/main/services/ProfileSyncService.ts': 1650,
  'src/renderer/src/components/ConnectionModal/ConnectionManagerModal.tsx': 1550,
  'src/main/smartcard/SmartcardCoordinator.ts': 1375,
  'src/renderer/src/components/TerminalView.tsx': 1325,
  'src/renderer/src/components/ConnectionModal/SSHProfileForm.tsx': 1275,
  'src/renderer/src/components/FileManager/FileEditorModal.tsx': 1250,
  'src/renderer/src/components/FileManager/DirectorySyncModal.tsx': 1250,
  'src/preload/index.ts': 1250,
  'src/renderer/src/components/FileManager/FilePane.tsx': 1200,
  'src/shared/types/ipc.ts': 1125,
  'src/renderer/src/components/SettingsModal/TeamVaultDetailPanel.tsx': 1075,
  'src/main/storage/S3StorageProvider.ts': 1025,
  'src/renderer/src/components/SettingsModal/SyncTargetForm.tsx': 1025,
  'src/renderer/src/components/ConnectionModal/K8sConnectionTree.tsx': 1000,
  'src/main/ssh/SSHPtyManager.ts': 975,
  'src/renderer/src/components/FileManager/FileList.tsx': 925,
  'src/main/transfer/TransferPipeline.ts': 925,
  'src/renderer/src/components/SettingsModal/SyncSettingsPanel.tsx': 925,
  'src/renderer/src/components/SettingsModal/TeamVaultListPanel.tsx': 875,
  'src/renderer/src/components/FileManager/DualPaneExplorer.tsx': 825,
  'src/renderer/src/components/K8s/K8sPodDetailModal.tsx': 825,
};

export default tseslint.config(
  {
    ignores: ['dist', 'dist-electron', 'node_modules', 'coverage', '*.config.js', '*.config.ts', '.claude/**', '.superpowers/**', 'pieces/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'tests/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // Only the long-standing hook rules; eslint-plugin-react-hooks v7 bundles
      // React Compiler-oriented rules (static-components, set-state-in-effect, ...)
      // under "recommended" which don't apply since this project doesn't use the compiler.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['src/main/**/*.{ts,cjs}', 'src/preload/**/*.ts', 'src/shared/**/*.ts', 'scripts/**/*.{mjs,js}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Security lint for the privileged (main/preload) processes. Non-literal fs paths
    // and object-injection are noisy by design in a file manager, so they stay off;
    // everything else (eval, child_process, unsafe regex, buffer asserts, ...) is an error.
    files: ['src/main/**/*.{ts,cjs}', 'src/preload/**/*.ts'],
    plugins: { security },
    rules: {
      ...security.configs.recommended.rules,
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
    },
  },
  {
    files: ['**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx,cjs}'],
    ignores: ['**/*.test.ts', '**/*.test.tsx', '**/*.d.ts'],
    rules: { 'max-lines': ['error', MAX_LINES_DEFAULT] },
  },
  ...Object.entries(LARGE_FILE_CEILINGS).map(([file, max]) => ({
    files: [file],
    rules: { 'max-lines': ['error', max] },
  })),
  {
    // Everything in the main process goes through src/main/log so it is levelled, masked and persisted.
    files: ['src/main/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: { 'no-console': 'error' },
  }
);
