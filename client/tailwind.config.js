/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Miro design system colors
        canvas: {
          DEFAULT: '#ffffff',
          raised: '#f7f8fa',
          overlay: '#fafbfc',
        },
        brand: {
          DEFAULT: '#1c1c1e',
          muted: 'rgba(28,28,30,0.06)',
        },
        surface: {
          DEFAULT: '#f5f5f7',
          border: '#e0e2e8',
          hover: '#eef0f3',
          active: '#c7cad5',
        },
        typo: {
          primary: '#1c1c1e',
          secondary: '#555a6a',
          muted: '#8e91a0',
          disabled: '#a5a8b5',
        },
        // Miro brand accent colors
        miro: {
          yellow: '#ffd02f',
          'yellow-deep': '#fcb900',
          'yellow-light': '#fff4c4',
          blue: '#4262ff',
          'blue-pressed': '#2a41b6',
          coral: '#ff9999',
          'coral-light': '#ffc6c6',
          rose: '#ffd8f4',
          'rose-light': '#fde0f0',
          teal: '#0fbcb0',
          'teal-light': '#c3faf5',
        },
        // Semantic colors
        danger: {
          DEFAULT: '#e03e2d',
          muted: 'rgba(224,62,45,0.08)',
        },
        success: {
          DEFAULT: '#00b473',
          muted: 'rgba(0,180,115,0.08)',
        },
        warning: {
          DEFAULT: '#fcb900',
          muted: 'rgba(252,185,0,0.10)',
        },
        accent: {
          DEFAULT: '#4262ff',
          muted: 'rgba(66,98,255,0.08)',
        },
        // Hairline borders (Miro)
        hairline: {
          DEFAULT: '#e0e2e8',
          soft: '#eef0f3',
          strong: '#c7cad5',
        },
        // Ink / text tones
        ink: {
          deep: '#050038',
          DEFAULT: '#1c1c1e',
        },
        // Footer
        footer: {
          bg: '#1c1c1e',
        },
      },
      fontFamily: {
        display: ['Roobert PRO', 'Inter', '"Noto Sans SC"', 'sans-serif'],
        body: ['Roobert PRO', 'Inter', '"Noto Sans SC"', 'sans-serif'],
        mono: ['"Geist Mono"', '"JetBrains Mono"', 'monospace'],
      },
      fontSize: {
        'hero-display': ['5rem', { lineHeight: '1.05', letterSpacing: '-0.04em', fontWeight: '500' }],
        'display-lg': ['3.75rem', { lineHeight: '1.10', letterSpacing: '-0.03em', fontWeight: '500' }],
        'display-md': ['2.25rem', { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '500' }],
        'eyebrow': ['0.6875rem', { lineHeight: '1', letterSpacing: '0.08em', fontWeight: '600' }],
      },
      borderRadius: {
        pill: '9999px',
        card: '16px',
        input: '8px',
        modal: '20px',
        feature: '32px',
      },
      borderWidth: {
        hairline: '1px',
      },
      letterSpacing: {
        display: '-0.02em',
      },
    },
  },
  plugins: [],
};
