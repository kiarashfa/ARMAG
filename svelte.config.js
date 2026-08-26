/**
 * Svelte configuration.
 *
 * `vite-plugin-svelte` looks for this file on every start and says so in the
 * log when it is missing. The default configuration is already what we want,
 * so this file's job is to state it — a log line that appears on every single
 * dev-server start trains you to stop reading the log, which is expensive the
 * day it says something that matters.
 *
 * `vitePreprocess` is what lets `<script lang="ts">` work in a `.svelte` file.
 * `@astrojs/svelte` applies it for us; declaring it here keeps this file the
 * honest answer to "what preprocessing runs", rather than an empty object that
 * implies none does.
 */
import { vitePreprocess } from '@astrojs/svelte';

export default {
  preprocess: vitePreprocess(),
};
