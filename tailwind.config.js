/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      screens: {
        'xs':            '480px',
        'fold-cover':    { 'max': '450px' },
        'fold-unfolded': { 'min': '600px' },
      },

      /* ── Organic / Natural Palette ─────────────────────── */
      colors: {
        background:  '#FDFCF8',   // Rice Paper
        foreground:  '#2C2C24',   // Deep Loam / Charcoal
        primary: {
          DEFAULT:    '#5D7052',  // Moss Green
          foreground: '#F3F4F1',  // Pale Mist
          10:         'rgba(93,112,82,0.10)',
          20:         'rgba(93,112,82,0.20)',
        },
        secondary: {
          DEFAULT:    '#C18C5D',  // Terracotta / Clay
          foreground: '#FFFFFF',
          10:         'rgba(193,140,93,0.10)',
          20:         'rgba(193,140,93,0.20)',
        },
        accent: {
          DEFAULT:    '#E6DCCD',  // Sand / Beige
          foreground: '#4A4A40',  // Bark
        },
        muted: {
          DEFAULT:    '#F0EBE5',  // Stone
          foreground: '#78786C',  // Dried Grass
        },
        card: {
          DEFAULT:    '#FEFEFA',  // Surface Warm White
          foreground: '#2C2C24',
        },
        popover: {
          DEFAULT:    '#FEFEFA',
          foreground: '#2C2C24',
        },
        border:       '#DED8CF',  // Raw Timber
        destructive:  '#A85448',  // Burnt Sienna

        // Dark mode variants
        dark: {
          bg:      '#1A1D17',   // Forest Floor
          surface: '#1E2219',   // Dark Card
          card:    '#1E2219',
          border:  'rgba(255,255,255,0.08)',
          fg:      '#E8E5DC',   // Aged Parchment
          muted:   '#8A8A7E',   // Dim Grass
        },
      },

      /* ── Typography ────────────────────────────────────── */
      fontFamily: {
        sans:      ['Philosopher', 'serif'],
        display:   ['Philosopher', 'serif'],
        signature: ['"Dancing Script"', 'cursive'],
      },

      /* ── Shadows — tinted, diffused, organic ───────────── */
      boxShadow: {
        'soft':        '0 4px 20px -2px rgba(93,112,82,0.15)',
        'soft-md':     '0 6px 28px -4px rgba(93,112,82,0.18)',
        'float':       '0 10px 40px -10px rgba(193,140,93,0.20)',
        'float-sm':    '0 6px 24px -6px rgba(193,140,93,0.15)',
        'clay':        '0 4px 20px -2px rgba(193,140,93,0.15)',
        'deep':        '0 20px 50px -12px rgba(44,44,36,0.18)',
        'inner-soft':  'inset 0 2px 8px rgba(44,44,36,0.08)',
        'glass':       '0 8px 32px rgba(44,44,36,0.06)',
      },

      /* ── Border Radius ─────────────────────────────────── */
      borderRadius: {
        '4xl':  '2rem',
        '5xl':  '2.5rem',
        '6xl':  '3rem',
      },

      /* ── Background Images ─────────────────────────────── */
      backgroundImage: {
        // Procedural grain used as grain texture overlay
        'grain': "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='400' height='400' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E\")",
      },

      backdropBlur: {
        xs: '4px',
      },

      /* ── Keyframes ─────────────────────────────────────── */
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(20px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        blobFloat: {
          '0%, 100%': { transform: 'translate(0px, 0px) scale(1)' },
          '33%':       { transform: 'translate(12px, -14px) scale(1.03)' },
          '66%':       { transform: 'translate(-10px, 8px) scale(0.97)' },
        },
      },

      animation: {
        'fadeIn':    'fadeIn 0.3s ease both',
        'slideUp':   'slideUp 0.35s ease both',
        'blobFloat': 'blobFloat 12s ease-in-out infinite',
        'blobFloat2':'blobFloat 16s ease-in-out infinite reverse',
      },
    },
  },
  plugins: [],
};
