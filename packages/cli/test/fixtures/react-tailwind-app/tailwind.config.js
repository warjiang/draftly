/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#3b6ea5',
        surface: '#ffffff',
        muted: '#8a8a85',
        accent: {
          500: '#d97706',
        },
      },
    },
  },
  plugins: [],
};
