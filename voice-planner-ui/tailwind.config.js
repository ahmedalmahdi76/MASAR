/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // We'll call this class 'font-arabic'
        arabic: ['"Cairo"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

