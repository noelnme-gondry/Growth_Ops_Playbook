// ── jsdom render-smoke setup ────────────────────────────────────────────────
// Loaded by the "smoke" vitest project (jsdom env) BEFORE any *.smoke.test.jsx.
// Stubs the browser/Chart.js/Next surfaces jsdom lacks so component RENDER +
// mount effects never throw for environment reasons — leaving real render/effect
// bugs (the CampaignPvm-class crashes) as the only thing that can throw.
import { vi, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Chart.js — jsdom has no real canvas 2d context. Every tool imports
// `chart.js/auto` (default export = Chart, called with `new Chart(...)`).
// Stub instance methods components call, plus the static `register`.
vi.mock("chart.js/auto", () => ({
  default: class Chart {
    constructor() {}
    update() {}
    destroy() {}
    resize() {}
    draw() {}
    static register() {}
  },
}));

// next/navigation — no Next router context under vitest. Components call
// useRouter()/usePathname()/useParams()/notFound() at render time.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push() {},
    replace() {},
    prefetch() {},
    back() {},
    forward() {},
    refresh() {},
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect() {},
  notFound() {},
}));

// ResizeObserver — Chart.js responsive + observers reference it; jsdom lacks it.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!globalThis.ResizeObserver) globalThis.ResizeObserver = ResizeObserverStub;

// matchMedia — theme/media queries call it; jsdom returns undefined.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  });
}

// canvas.getContext — jsdom throws "not implemented" without a real canvas backend.
// A plain object is enough since Chart.js itself is mocked away.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = () => ({});
}

// Unmount React trees between tests so effects/cleanups don't leak across cases.
afterEach(() => {
  cleanup();
});
