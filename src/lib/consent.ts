// Cookie consent for Google Analytics. Nothing from Google loads before the visitor accepts.
// One answer is stored for the whole origin, so it covers every project on it.

export type ConsentChoice = 'granted' | 'denied';

const KEY = 'kfa-consent';
const VERSION = 1;
const DEBUG_KEY = 'kfa-consent-debug';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    [key: `ga-disable-${string}`]: boolean | undefined;
  }
}

let memory: ConsentChoice | null = null;
let started = false;
let lastPath = '';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readConsent(): ConsentChoice | null {
  const store = storage();
  if (!store) return memory;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return memory;
    const record = JSON.parse(raw) as { v?: number; analytics?: string };
    if (record.v !== VERSION) return null;
    return record.analytics === 'granted' || record.analytics === 'denied'
      ? record.analytics
      : null;
  } catch {
    return null;
  }
}

function writeConsent(choice: ConsentChoice): void {
  memory = choice;
  try {
    storage()?.setItem(
      KEY,
      JSON.stringify({ v: VERSION, analytics: choice, at: new Date().toISOString() }),
    );
  } catch {
    // Storage is blocked: the answer lasts for this page view only.
  }
}

// Local development and tests never report, unless the debug flag is set in localStorage.
function isLocal(): boolean {
  const host = location.hostname;
  const local =
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
  if (!local) return false;
  try {
    return window.localStorage.getItem(DEBUG_KEY) !== '1';
  } catch {
    return true;
  }
}

// Only the origin and the path are sent: whatever follows a ? or a # stays private.
function sendPageView(): void {
  const path = location.pathname;
  if (path === lastPath) return;
  lastPath = path;
  window.gtag?.('event', 'page_view', {
    page_location: location.origin + path,
    page_title: document.title,
  });
}

function startAnalytics(id: string): void {
  if (!id || isLocal()) return;
  window[`ga-disable-${id}`] = false;
  if (started) return;
  started = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // gtag.js expects the arguments object itself, not an array copy.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer?.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', id, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  sendPageView();
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.append(script);
  // Pages that change the address without reloading (single-page apps) count as page views too.
  window.addEventListener('popstate', sendPageView);
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args);
      queueMicrotask(sendPageView);
      return result;
    };
  }
}

function stopAnalytics(id: string): void {
  if (id) window[`ga-disable-${id}`] = true;
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0]?.trim() ?? '';
    if (name !== '_ga' && !name.startsWith('_ga_')) continue;
    for (const domain of ['', `; domain=${location.hostname}`, `; domain=.${location.hostname}`]) {
      document.cookie = `${name}=; Max-Age=0; path=/${domain}`;
    }
  }
}

// Wires the bar: shows it until an answer exists, applies the answer, and lets any element
// marked data-consent-open (a "Cookie settings" link) reopen it.
export function initConsent(id: string, bar: HTMLElement | null): void {
  if (!id || !bar || bar.dataset.consentReady) return;
  bar.dataset.consentReady = '1';

  const show = () => {
    bar.classList.remove('is-out');
    bar.hidden = false;
  };
  const hide = () => {
    bar.classList.add('is-out');
    window.setTimeout(() => {
      bar.hidden = true;
      bar.classList.remove('is-out');
    }, 250);
  };
  const apply = (choice: ConsentChoice | null) => {
    if (choice === 'granted') startAnalytics(id);
    else if (choice === 'denied') stopAnalytics(id);
  };

  const stored = readConsent();
  apply(stored);
  if (stored === null) show();

  bar.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-consent-choice]');
    if (!button) return;
    const choice = button.dataset.consentChoice === 'granted' ? 'granted' : 'denied';
    writeConsent(choice);
    apply(choice);
    hide();
  });

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-consent-open]')) return;
    event.preventDefault();
    show();
    bar.querySelector<HTMLElement>('[data-consent-choice]')?.focus();
  });

  // Another tab or project page on this origin answered: follow it.
  window.addEventListener('storage', (event) => {
    if (event.key !== KEY) return;
    const choice = readConsent();
    apply(choice);
    if (choice) hide();
  });
}
