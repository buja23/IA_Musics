/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#06090f',
        surface: '#0b111e',
        'surface-highlight': '#131c31',
        'surface-border': '#1e2b45',
        neon: {
          cyan: '#00f0ff',
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
