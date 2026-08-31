# `scripts/data/` — the authoring pipeline

Authoring-time only. **Nothing here runs during `astro build`, `npm test` or
CI**, so the Python dependency below costs the build nothing. The only parts of
this directory the gated build touches are the three test files, which are pure
and need no network.

Requires Python with `Pillow` (WebP encoding) and `pymupdf` (PDF text).

    pip install Pillow pymupdf

## One entry, start to finish

```
node scripts/data/plan.mjs next 1                     # what to write, in rank order
node scripts/data/new-entry.mjs gun <slug> "<Article>"  # both files + the permalink citation
node scripts/data/wiki.mjs infobox "<Article>"        # leads, with the refs that back each
node scripts/data/spec.mjs read "<maker url>"         # the manufacturer's own figures
node scripts/data/manuals.mjs list                    # for a service arm, better than the maker
node scripts/data/image.mjs find "<Article>"          # then `image.mjs add …`
npm run check:content                                 # fails until every TODO is resolved
```

A cartridge swaps `spec.mjs`/`manuals.mjs` for:

```
node scripts/data/wiki.mjs loads "<Article>"          # and READ the test-barrel warning
node scripts/data/cip.mjs sync                        # once, ever
node scripts/data/cip.mjs sheet "<name>"
```

## What each script is for

| script | does |
|---|---|
| `plan.mjs` | The coverage plan. `build` \| `status` \| `next N`. Rank is deterministic — source count, then article size, then title. Nobody picks the batch. |
| `new-entry.mjs` | Scaffolds `<slug>.mdx` + `<slug>.json` with a real Wikipedia permalink. Fabricates nothing; the scaffold deliberately fails `check:content`. |
| `wiki.mjs` | `infobox` \| `loads` \| `refs` \| `cite` \| `raw` \| `grep`. Cites by `?oldid=`, never by title. |
| `wikidata.mjs` | `id` \| `show` \| `native` \| `cite`. Join key, native name, aliases — not a catalogue. |
| `image.mjs` | `find` \| `search` \| `cat` \| `licence` \| `add` \| `credit`. Licence is resolved **before** anything is downloaded. |
| `spec.mjs` | `read` \| `pdf`. Five extraction strategies, and it says which one answered. |
| `cip.mjs` | `sync` \| `find` \| `sheet`. Free cartridge dimensions and pressures. |
| `manuals.mjs` | `list` \| `check` \| `find`. Public-domain US military manuals, with rot detection. |
| `cpi.mjs` | Bakes `src/data/cpi.json`. Run once a year. |

## Four rules the scripts enforce so you do not have to remember them

1. **A velocity point needs a barrel length stated by a source.** Where none is
   stated, there is no point — record the mass and the ballistic coefficient
   and leave velocity out. `wiki.mjs loads` refuses to present a velocity table
   without saying this.
2. **Licence before download.** `image.mjs add` resolves the licence through the
   real `imageRef` schema first; a file that cannot produce a valid credit is
   never fetched. Nothing here can emit an `imageRef` without licence data.
3. **Cite Wikipedia by permalink.** Every citation this pipeline emits carries
   the revision it was read at, taken from the same call that fetched the
   content.
4. **Nothing interprets a figure.** "Weight" may be with or without a magazine;
   `bullet = 0.355` may be inches; `vel1` may be ft/s. The scripts show you the
   regime and the ambiguity. Deciding is the author's job, and the `sourceNote`
   is where the decision is recorded.

## Caches

`.cache/` (C.I.P. index, scratch PDFs) and `plan/` are gitignored. Both are
derived and regenerating them is one command. Neither is committed: they are
copies of someone else's index, and SPEC.md Appendix A permits extraction per
entry, not bulk mirroring.
