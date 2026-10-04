/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        pixel: ['"Press Start 2P"', 'monospace'],
        body: ['"Nunito"', 'ui-rounded', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: '#17162b',
        panel: '#24233f',
        cream: '#fff4d9',
        coral: '#ff8e80',
        mint: '#a9e7c6',
        lilac: '#bcb2ff',
      },
      boxShadow: {
        pixel: '0 5px 0 rgba(0,0,0,.28)',
        card: '0 7px 0 rgba(13,12,29,.38)',
      },
    },
  },
  plugins: [],
}