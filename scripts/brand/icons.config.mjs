/**
 * ARMAG's app icons: what `icons.mjs` draws. Everything site-specific lives
 * here; the layout it is poured into is `icons.mjs`.
 *
 * Colours are the dark theme's tokens from `src/styles/global.css`, converted
 * from oklch to hex because the icons are rendered outside the browser. Re-run
 * `npm run brand:icons` after changing any of them. The social image has its
 * own config, `brand.config.ts`.
 */
const fontsource = (pkg, file) => `node_modules/@fontsource/${pkg}/files/${file}`;

export default {
  name: 'ARMAG',
  wordmark: [{ text: 'ARMAG', weight: 700 }],

  cardTheme: 'dark',
  colors: {
    background: '#0a0c10',
    ink: '#f0f2f4',
    inkSoft: '#babec3',
    muted: '#95999e',
    line: '#25292e',
    accent: '#1ec5e4',
  },

  fonts: {
    display: {
      family: 'IBM Plex Sans Condensed',
      weight: 700,
      tracking: -1,
      files: [{ path: fontsource('ibm-plex-sans-condensed', 'ibm-plex-sans-condensed-latin-700-normal.woff'), weight: 700 }],
    },
    body: {
      family: 'IBM Plex Sans',
      files: [
        { path: fontsource('ibm-plex-sans', 'ibm-plex-sans-latin-400-normal.woff'), weight: 400 },
        { path: fontsource('ibm-plex-sans', 'ibm-plex-sans-latin-600-normal.woff'), weight: 600 },
      ],
    },
  },

  // Plain colours on its own dark plate.
  mark: (svg) => svg,
};
