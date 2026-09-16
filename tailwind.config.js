/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        app: {
          DEFAULT: 'var(--bg-app)',
          surface: 'var(--bg-surface)',
          'surface-subtle': 'var(--bg-surface-subtle)',
          'surface-hover': 'var(--bg-surface-hover)',
          card: 'var(--bg-card)',
          input: 'var(--bg-input)',
        },
        border: {
          subtle: 'var(--border-subtle)',
          strong: 'var(--border-strong)',
        },
        txt: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        accent: {
          DEFAULT: 'var(--accent-primary)',
          hover: 'var(--accent-hover)',
          subtle: 'var(--accent-subtle)',
        },
        terminal: {
          bg: '#0f172a',
          surface: '#1e293b',
          border: '#334155',
          text: '#f8fafc',
          accent: '#38bdf8',
        },
      },
    },
  },
  plugins: [],
}
