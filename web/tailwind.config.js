/**
 * SM ERP design tokens — "the school register".
 *  - ink: the deep navy chrome (sidebar, parent header, login panel)
 *  - indigo: remapped to the brand blue, so every existing indigo-* class rebrands
 *  - marigold: the warm "you are here / today" accent, used sparingly
 *  - canvas / surface / line: semantic surfaces that switch with the colour scheme (CSS variables in globals.css)
 *  - slate: kept for neutral text; the darkest steps are nudged toward the ink navy so dark mode matches the chrome
 */

/** rgb channels from a CSS variable, so opacity modifiers (bg-surface/80) still work. */
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0E1A33',
          900: '#15254A',
          800: '#1E3260',
          700: '#2A3F72',
          text: '#C5CFE3',
          muted: '#8392B3',
        },
        indigo: {
          50: '#EEF1FD',
          100: '#DCE2FB',
          200: '#BAC6F7',
          300: '#8FA2F1',
          400: '#6178E8',
          500: '#3F57DC',
          600: '#2E44C4',
          700: '#25379F',
          800: '#213180',
          900: '#1F2D66',
          950: '#141B3D',
        },
        marigold: {
          50: '#FEF6E7',
          100: '#FDEBC8',
          300: '#F8CB79',
          400: '#F5B544',
          500: '#E99A1A',
          600: '#C77D0B',
          700: '#9A5F06',
        },
        slate: {
          200: '#E2E7EF',
          800: '#1F2B44',
          900: '#101A2E',
          950: '#0A1121',
        },
        canvas: v('--canvas'),
        surface: { DEFAULT: v('--surface'), muted: v('--surface-muted') },
        line: { DEFAULT: v('--line'), strong: v('--line-strong') },
      },
      fontFamily: {
        sans: ['"Onest Variable"', 'Onest', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', '"Noto Sans"', 'sans-serif'],
      },
      fontSize: {
        // UI scale: 12 / 13 / 14 / 16 / 20 / 24 / 30
        xs: ['12px', { lineHeight: '16px' }],
        '13': ['13px', { lineHeight: '18px' }],
        sm: ['14px', { lineHeight: '20px' }],
        base: ['16px', { lineHeight: '24px' }],
        lg: ['18px', { lineHeight: '26px' }],
        xl: ['20px', { lineHeight: '28px' }],
        '2xl': ['24px', { lineHeight: '32px' }],
        '3xl': ['30px', { lineHeight: '36px' }],
      },
      borderRadius: {
        // controls 8px (lg), cards 12px (xl), modals and sheets 16px (2xl)
        lg: '8px',
        xl: '12px',
        '2xl': '16px',
      },
      boxShadow: {
        float: '0 12px 32px -8px rgb(14 26 51 / 0.18), 0 2px 6px -2px rgb(14 26 51 / 0.08)',
        pop: '0 24px 60px -12px rgb(14 26 51 / 0.35)',
      },
      maxWidth: {
        content: '1280px',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'sheet-up': { from: { transform: 'translateY(16px)', opacity: '0' }, to: { transform: 'none', opacity: '1' } },
        'drawer-in': { from: { transform: 'translateX(-100%)' }, to: { transform: 'none' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'sheet-up': 'sheet-up 200ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        'drawer-in': 'drawer-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
    },
  },
  plugins: [],
};
