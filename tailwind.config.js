/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        lichess: {
          bg: '#161512',
          panel: '#262421',
          panelHover: '#302e2c',
          border: '#3c3934',
          text: '#bababa',
          accent: '#629924',
          accentHover: '#73b32b',
          blue: '#3692e7'
        }
      }
    },
  },
  plugins: [],
};
