/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#4F46E5', light: '#6366F1', dark: '#4338CA', 50: '#EEF2FF', 100: '#E0E7FF', 200: '#C7D2FE', 300: '#A5B4FC', 400: '#818CF8', 500: '#4F46E5', 600: '#4338CA', 700: '#3730A3', 800: '#312E81', 900: '#1E1B4B' },
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
        bg: { DEFAULT: '#F8FAFC', card: '#FFFFFF', dark: '#F1F5F9' },
        text: { primary: '#1E293B', secondary: '#64748B', muted: '#94A3B8' },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Noto Sans SC"', '"Noto Sans"', 'sans-serif'],
      },
      borderRadius: {
        card: '12px',
        btn: '8px',
        input: '6px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)',
        elevated: '0 4px 12px rgba(0,0,0,0.1)',
      },
    },
  },
  plugins: [],
};
