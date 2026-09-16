import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist', 'dist-electron', 'node_modules', 'coverage', '*.config.js', '*.config.ts'],
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
    files: ['src/main/**/*.{ts,cjs}', 'src/preload/**/*.ts', 'src/shared/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
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
  }
);
