'use client';

import { DEFAULT_THEMES } from '@pierre/diffs';
import {
  type WorkerInitializationRenderOptions,
  WorkerPoolContextProvider,
  type WorkerPoolOptions,
} from '@pierre/diffs/react';
import type { ReactNode } from 'react';

// Shiki tokenizing on the main thread is what makes a large diff stutter: every
// newly scrolled-in file competes with scrolling for the same thread. The pool
// moves that work to web workers, so scrolling stays on the compositor.
//
// The pool is created once above the review surface and outlives a change of
// pull request, so its AST cache survives switching between reviews.

function isMobileBrowser(): boolean {
  const agent = globalThis.navigator;
  if (agent == null) return false;
  return (
    agent.maxTouchPoints > 0 &&
    globalThis.matchMedia?.('(max-width: 767px), (pointer: coarse)').matches ===
      true
  );
}

/** A phone has neither the cores nor the memory for a wide pool. */
function resourceLimits(): { poolSize: number; totalASTLRUCacheSize: number } {
  return isMobileBrowser()
    ? { poolSize: 1, totalASTLRUCacheSize: 10 }
    : { poolSize: 3, totalASTLRUCacheSize: 100 };
}

const LIMITS = resourceLimits();

const POOL_OPTIONS: WorkerPoolOptions = {
  // Leave one core for the main thread, and never take more than the limit.
  poolSize: Math.min(
    Math.max(1, (globalThis.navigator?.hardwareConcurrency ?? 1) - 1),
    LIMITS.poolSize
  ),
  totalASTLRUCacheSize: LIMITS.totalASTLRUCacheSize,
  workerFactory() {
    return new Worker(
      new URL('@pierre/diffs/worker/worker.js', import.meta.url)
    );
  },
};

// Both themes load at once, so switching color mode needs no worker round trip:
// the worker tokenizes for the pair and the viewer picks the active one.
const HIGHLIGHTER_OPTIONS: WorkerInitializationRenderOptions = {
  theme: DEFAULT_THEMES,
  langs: [
    'css',
    'go',
    'json',
    'markdown',
    'python',
    'rust',
    'sh',
    'sql',
    'tsx',
    'typescript',
    'yaml',
  ],
  preferredHighlighter: 'shiki-wasm',
};

export function WorkerPoolProvider({ children }: { children: ReactNode }) {
  return (
    <WorkerPoolContextProvider
      poolOptions={POOL_OPTIONS}
      highlighterOptions={HIGHLIGHTER_OPTIONS}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}
