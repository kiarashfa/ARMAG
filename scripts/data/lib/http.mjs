/**
 * The one place the authoring pipeline talks to the network.
 *
 * Ported from Markey's `scripts/data/lib/http.mjs`, which learned all three of
 * these the hard way:
 *
 *  - **Wikimedia rate-limits.** Consecutive image downloads return HTTP 429
 *    even with a proper User-Agent. A per-host delay and a backoff are not
 *    optional at batch scale.
 *  - **A descriptive User-Agent is a condition of use** of the Wikimedia APIs.
 *    An anonymous one is throttled harder.
 *  - A failed fetch must be loud. A silent empty result becomes a missing
 *    figure, and a missing figure that should have been sourced is exactly the
 *    quiet wrongness Instruction.md §0 rule 2 exists to prevent.
 *
 * ARMAG additions over Markey's copy, both from the Phase 8 friction log:
 *  - `bobp.cip-bobp.org` is a small volunteer-run site serving one-page PDFs.
 *    It gets a deliberately slow delay; we are transcribing a dozen numbers,
 *    not mirroring their database (SPEC.md Appendix A, governing rule).
 *  - `getBuffer()` exists because every image now goes through a re-encoder
 *    rather than straight to disk (SPEC.md §10 is WebP only).
 */

/** Contact details are part of the Wikimedia UA policy, not decoration. */
export const USER_AGENT =
  'ARMAG/0.1 (https://kiarashfa.github.io/ARMAG/; kiarashfa@gmail.com)';

/** Minimum gap between requests to the same host, milliseconds. */
const HOST_DELAY_MS = {
  'upload.wikimedia.org': 1100,
  'commons.wikimedia.org': 400,
  'en.wikipedia.org': 400,
  'www.wikidata.org': 400,
  'query.wikidata.org': 1000,
  'api.bls.gov': 1000,
  // Not a rate limit they publish — a courtesy. See the module header.
  'bobp.cip-bobp.org': 1500,
  default: 300,
};

const lastCallAt = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForTurn(host) {
  const delay = HOST_DELAY_MS[host] ?? HOST_DELAY_MS.default;
  const previous = lastCallAt.get(host) ?? 0;
  const wait = previous + delay - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt.set(host, Date.now());
}

/**
 * Fetch with throttling, a real User-Agent, and backoff on 429/5xx.
 *
 * Throws on a status still failing after the retries, because at that point
 * the caller cannot produce honest data and should stop rather than write a
 * gap it did not mean.
 */
export async function get(url, { accept, retries = 3, timeoutMs = 60000, headers = {} } = {}) {
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt += 1) {
    await waitForTurn(host);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, ...(accept ? { Accept: accept } : {}), ...headers },
        signal: controller.signal,
        redirect: 'follow',
      });
    } catch (error) {
      if (attempt >= retries) throw new Error(`GET ${url} failed: ${error.message}`);
      await sleep(2000 * (attempt + 1));
      continue;
    } finally {
      clearTimeout(timer);
    }

    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 3000 * (attempt + 1),
      );
      continue;
    }
    if (!response.ok) throw new Error(`GET ${url} → HTTP ${response.status}`);
    return response;
  }
}

export async function getJson(url, options) {
  const response = await get(url, { accept: 'application/json', ...options });
  return response.json();
}

export async function getText(url, options) {
  const response = await get(url, options);
  return response.text();
}

/** Raw bytes — images before re-encoding, PDFs before parsing. */
export async function getBuffer(url, options) {
  const response = await get(url, { timeoutMs: 120000, ...options });
  return Buffer.from(await response.arrayBuffer());
}

/** POST JSON and read JSON back. The BLS API takes its query in the body. */
export async function postJson(url, body, { retries = 2, timeoutMs = 60000 } = {}) {
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt += 1) {
    await waitForTurn(host);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (attempt >= retries) throw new Error(`POST ${url} failed: ${error.message}`);
      await sleep(2000 * (attempt + 1));
      continue;
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 500 && attempt < retries) {
      await sleep(3000 * (attempt + 1));
      continue;
    }
    if (!response.ok) throw new Error(`POST ${url} → HTTP ${response.status}`);
    return response.json();
  }
}

/** Builds a query string without the double-encoding traps of manual joins. */
export function withQuery(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}
