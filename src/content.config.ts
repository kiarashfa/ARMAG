/**
 * Content Layer API collection definitions — SPEC.md §5.
 *
 * Three narrative/data pairs (guns, cartridges, makers) plus two single-file
 * collections (glossary, articles) and one reserved slot (accessories, §5.7).
 *
 * The pairing itself — every `.mdx` having exactly one `.json` sibling and vice
 * versa — is a cross-file property Zod cannot see, so it is enforced by
 * `src/integrations/integrity.ts` at `astro:build:start` (SPEC.md §13).
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'zod';

import { cartridgeDataSchema, cartridgeNarrativeSchema } from './schemas/cartridge.ts';
import { gunDataSchema, gunNarrativeSchema } from './schemas/gun.ts';
import { makerDataSchema, makerNarrativeSchema } from './schemas/maker.ts';
import { isoDate, imageRef, slug } from './schemas/primitives.ts';

/**
 * `glob()`, but silent about a collection nobody has authored yet.
 *
 * Astro's glob loader warns on every dev-server start when a pattern matches
 * nothing. For `accessories` that warning is not news — the collection is empty
 * on purpose until v2 — and a warning that fires on every single start is how
 * you train yourself to stop reading the log, which is expensive the day it
 * says something that matters.
 *
 * It only stays quiet for a directory with **no matching files at all**, which
 * is exactly the "not written yet" case. A directory with files in it goes
 * through the real loader and warns about anything wrong with them.
 */
function globWhenAuthored(options: { base: string; pattern: string }) {
  const inner = glob(options);
  const extension = path.extname(options.pattern);
  const directory = path.resolve(options.base);

  return {
    ...inner,
    load: async (context: Parameters<typeof inner.load>[0]) => {
      const authored =
        existsSync(directory) && readdirSync(directory).some((file) => file.endsWith(extension));
      if (!authored) {
        context.store.clear();
        return;
      }
      return inner.load(context);
    },
  };
}

const guns = defineCollection({
  loader: globWhenAuthored({ base: './src/content/guns', pattern: '**/*.mdx' }),
  schema: gunNarrativeSchema,
});

const gunData = defineCollection({
  loader: globWhenAuthored({ base: './src/content/gunData', pattern: '**/*.json' }),
  schema: gunDataSchema,
});

const cartridges = defineCollection({
  loader: globWhenAuthored({ base: './src/content/cartridges', pattern: '**/*.mdx' }),
  schema: cartridgeNarrativeSchema,
});

const cartridgeData = defineCollection({
  loader: globWhenAuthored({ base: './src/content/cartridgeData', pattern: '**/*.json' }),
  schema: cartridgeDataSchema,
});

const makers = defineCollection({
  loader: globWhenAuthored({ base: './src/content/makers', pattern: '**/*.mdx' }),
  schema: makerNarrativeSchema,
});

const makerData = defineCollection({
  loader: globWhenAuthored({ base: './src/content/makerData', pattern: '**/*.json' }),
  schema: makerDataSchema,
});

/**
 * Glossary terms — single-file MDX, no data twin (SPEC.md §5.6).
 *
 * Every term is auto-crosslinked from every occurrence in any prose on the
 * site by a rehype plugin (Phase 11), so link density needs no manual upkeep.
 */
const glossary = defineCollection({
  loader: globWhenAuthored({ base: './src/content/glossary', pattern: '**/*.mdx' }),
  schema: z
    .object({
      id: slug,
      term: z.string().min(1),
      aka: z.array(z.string()).default([]),
      /** One-line definition, used in the crosslink tooltip and JSON-LD. */
      short: z.string().min(1),
      seeAlso: z.array(slug).default([]),
    })
    .strict(),
});

/** The magazine half — long-form editorial, each linking 20+ entries. */
const articles = defineCollection({
  loader: globWhenAuthored({ base: './src/content/articles', pattern: '**/*.mdx' }),
  schema: z
    .object({
      id: slug,
      title: z.string().min(1),
      standfirst: z.string().min(1),
      published: isoDate,
      updated: isoDate.optional(),
      heroImage: imageRef.optional(),
    })
    .strict(),
});

/**
 * Accessories — v2 (SPEC.md §5.7). The slot exists in v1 so the collection can
 * be authored without a config change, and so the `fits[]` edges already on the
 * gun schema have a declared destination.
 */
const accessories = defineCollection({
  loader: globWhenAuthored({ base: './src/content/accessories', pattern: '**/*.mdx' }),
  schema: z
    .object({
      id: slug,
      name: z.string().min(1),
    })
    .strict(),
});

export const collections = {
  guns,
  gunData,
  cartridges,
  cartridgeData,
  makers,
  makerData,
  glossary,
  articles,
  accessories,
};
