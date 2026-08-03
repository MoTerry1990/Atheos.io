import "@testing-library/dom";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";

/**
 * jsdom is missing several APIs Radix and Motion assume exist. Each of these
 * is a no-op stub rather than a polyfill — the tests here assert behaviour and
 * accessibility wiring, not layout, which jsdom cannot compute anyway.
 */
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

globalThis.IntersectionObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
  root = null;
  rootMargin = "";
  thresholds = [];
} as never;

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
})) as never;

// Radix uses these for focus management and pointer capture.
Element.prototype.scrollIntoView ??= vi.fn();
Element.prototype.hasPointerCapture ??= (() => false) as never;
Element.prototype.setPointerCapture ??= vi.fn();
Element.prototype.releasePointerCapture ??= vi.fn();

afterEach(() => cleanup());
