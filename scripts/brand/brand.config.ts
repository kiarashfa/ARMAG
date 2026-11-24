import type { BrandConfig } from './brand.ts';

/**
 * Social card of ARMAG: the one image used for link previews and for the GitHub social preview.
 * Edit the values below and run `npm run brand`; the layout itself is in brand.ts.
 * Paths are relative to the folder that holds `public/`.
 */
export default {
  name: 'ARMAG',
  // The wordmark as HTML. The families are the ones listed in `fonts`; an accent letter is a coloured span.
  wordmark: `<span style="font-family:PlexCond;font-weight:700;letter-spacing:.01em">ARMAG</span>`,
  wordmarkSize: 150,
  // One short creative line, specific to this project.
  line: 'Every figure sourced. Every gap shown.',
  background: '#0a0c10',
  // Accent: rules, diamonds, first glow and most lights. Secondary: second glow and some lights.
  primary: '#1ec5e4',
  secondary: '#9ad4ea',
  // The icon tile shown on the card.
  icon: 'public/icon-512.png',
  bodyFont: 'Plex',
  fonts: [
    { family: 'PlexCond', file: 'scripts/brand/fonts/ibm-plex-sans-condensed-700-normal.woff', weight: 700 },
    { family: 'Plex', file: 'scripts/brand/fonts/ibm-plex-sans-400-normal.woff', weight: 400 },
  ],
  output: 'public/og-image.jpg',
} satisfies BrandConfig;
