# Third-party material

ARMAG includes or relies on the third-party material listed here. Each item stays under its own license, and the KFA Source-Available License does not apply to it.

## Software

Software that is delivered to visitors, either as script or as the generated stylesheet.

| Name | Used for | License |
| --- | --- | --- |
| [Astro](https://astro.build) | static site framework and the client runtime that loads interactive components | MIT |
| [Svelte](https://svelte.dev) | interactive components (ballistics and recoil calculators, catalogue, compare tool, armory) | MIT |
| [@astrojs/svelte](https://docs.astro.build/en/guides/integrations-guide/svelte/) | Svelte integration and client-side loading of those components | MIT |
| [Zod](https://zod.dev) | schema validation of the armory data a visitor keeps in their own browser | MIT |
| [Pagefind](https://github.com/Pagefind/pagefind) | site search (the index is built at publish time and the search script runs in the browser) | MIT |
| [Tailwind CSS](https://tailwindcss.com) | generates the site stylesheet, whose notice is kept in the built CSS | MIT |

The ballistics solver is the project's own. Open-source implementations are used only as a validation corpus in the test suite, and the one used is listed under Data and services.

## Fonts

| Font | License | Source |
| --- | --- | --- |
| IBM Plex Sans (variable, width and weight axes) | SIL OFL 1.1 | Fontsource package `@fontsource-variable/ibm-plex-sans`, self-hosted and bundled into the site CSS. Copyright 2019 IBM Corp. |
| IBM Plex Sans and IBM Plex Sans Condensed (static) | SIL OFL 1.1 | Fontsource packages `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-sans-condensed`. Used only to draw the social preview card (`public/og-image.jpg`) at build time and not served as fonts. Their license text is also kept in `scripts/brand/fonts/FONT-LICENSES.txt`. |

## Data and services

| Name | Used for | Terms |
| --- | --- | --- |
| [Wikimedia Commons](https://commons.wikimedia.org) | photographs and manufacturer marks, credited per file | the license recorded for each file (see Media) |
| [Wikipedia](https://en.wikipedia.org) | figures and facts, cited per entry at a permanent revision link (388 references) | CC BY-SA 4.0, as recorded on each reference |
| Wikidata | identifiers, native-script labels and aliases (363 entries carry an identifier) | CC0 |
| [DVIDS](https://www.dvidshub.net) | 14 photographs by US military photographers | public domain, as recorded on each image |
| Smithsonian Open Access (National Museum of American History) | 1 photograph | CC0, as recorded on the image |
| US Army Ballistic Research Laboratory G1 and G7 standard drag functions | drag tables for the trajectory solver, transcribed from the tables published by [JBM Ballistics](https://jbmballistics.com) and cross-checked against an independent implementation | public domain |
| SAAMI and C.I.P. | cartridge and chamber dimensions and maximum pressures; the figures are transcribed and the drawings are not republished | cited per figure (117 references) |
| [US Bureau of Labor Statistics](https://www.bls.gov/cpi/) | Consumer Price Index series (CPI-U, annual average) used to adjust historical prices; baked into the site at authoring time, with no runtime call | US Government data |
| Manufacturer specifications, US military manuals, periodicals and other web sources | figures and facts, cited per entry (64 manufacturer specification, 6 military manual, 8 periodical, 1 book and 41 web references) | cited, not reproduced; public-domain manuals are recorded as such on their reference |
| Google Analytics (loaded from `www.googletagmanager.com`) | page-view statistics in the published site only; the page address is sent without query string or fragment | Google's terms apply |
| [py-ballisticcalc](https://github.com/o-murphy/py-ballisticcalc) 2.2.0 | reference trajectories computed once and committed as a test fixture (`test-fixtures/ballistics/reference-trajectories.json`); the library is not a dependency and is not distributed | LGPL-3.0 (the library) |

The site makes no other runtime call to a third party. Everything else it fetches comes from its own origin.

## Media

Photographs and marks are credited where they appear: every image carries an author, source page, license type and license note in its data record, shown in the credit panel opened by the "i" button on the image. The records are in the `credit` field of each image in `src/content/gunData/`, `src/content/cartridgeData/` and `src/content/makerData/`, and the site's `/attributions/` page summarizes them. 508 images carry a credit: 462 photographs and 46 manufacturer marks.

**Photographs (462)** come from Wikimedia Commons (447), DVIDS (14) and the Smithsonian National Museum of American History (1), each under the license recorded on the image:

| License | Count |
| --- | --- |
| CC BY-SA (4.0: 153, 3.0: 94, 2.0: 13, 2.5: 2, 1.0: 1) | 263 |
| CC BY (4.0: 11, 2.0: 10, 3.0: 9, 2.5: 5) | 35 |
| CC0 | 16 |
| Public domain | 147 |
| GFDL | 1 |

**Manufacturer marks (46)** are the trademarks of their owners and are reproduced to identify the manufacturer whose entry they appear on (nominative use). The source page of each is recorded: Wikimedia Commons (22), Wikipedia (18) and the manufacturer's own site (6). Where the source also records a file license, it is repeated in the record's license note. The marks are not covered by the KFA Source-Available License.

The PayPal and Buy Me a Coffee marks (`src/assets/paypal.svg` and `src/assets/buy-me-a-coffee.svg`) appear on the About page to identify the donation links. They are the trademarks of their owners and are not covered by the KFA Source-Available License.

## License texts

<details>
<summary>MIT License</summary>

```
Astro, @astrojs/svelte: Copyright (c) 2021 Fred K. Schott
  (Astro also carries parts that originate from the SvelteKit and Vite
  projects, under the same MIT terms: Copyright (c) 2020 SvelteKit contributors;
  Copyright (c) 2019-present, Yuxi (Evan) You and Vite contributors)
Svelte: Copyright (c) 2016-2025 Svelte Contributors
Zod: Copyright (c) 2025 Colin McDonnell
Pagefind: Copyright (c) Pagefind
Tailwind CSS: Copyright (c) Tailwind Labs, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>

<details>
<summary>SIL Open Font License 1.1</summary>

```
Copyright 2019 IBM Corp. All rights reserved.

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

</details>
