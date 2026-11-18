/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#181b1f',
        surface: '#1e2226',
        'surface-highlight': '#323840',
        'surface-border': '#121417',
        neon: {
          cyan: '#38bdf8',
          purple: '#b026ff',
          pink: '#ff007f',
          green: '#00ff66',
          orange: '#ff8800'
        }
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'cyan-glow': '0 0 20px -3px rgba(0, 240, 255, 0.4)',
        'cyan-glow-lg': '0 0 35px -5px rgba(0, 240, 255, 0.6)',
      }
    },
  },
  plugins: [],
}
