import { createStorage } from 'unstorage';

/**
 * The two things a runtime must supply for the served counter: somewhere to
 * keep the figure, and a way to let a flush outlive the request that started
 * it. Everything else — the batching, the backoff, the guard against a stale
 * read — is runtime-agnostic and lives in `servedCount.ts`.
 */
export interface ServedBackend {
  /** The stored figure, or null when nothing has been written yet. */
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  /**
   * Keeps `promise` running after its request ends: `waitUntil` on workerd, a
   * floating (but reported) promise on Node, whose process outlives requests.
   */
  keepAlive(promise: Promise<void>): void;
}

/** The one key the counter is stored under, on every backend. */
export const SERVED_KEY = 'served:total';

/**
 * The Cloudflare backend: the figure lives in the GHDIFF KV namespace behind
 * unstorage's binding driver, and a flush outlives its request through
 * `waitUntil`. The imports resolve lazily, inside the methods — a static one
 * would fail at bundle resolution time on the Node build, and the whole
 * function is the branch the Node build's dead-code elimination removes.
 */
async function cloudflareBackend(): Promise<ServedBackend> {
  const { env, waitUntil } = await import('cloudflare:workers');
  const { default: cloudflareKV } =
    await import('unstorage/drivers/cloudflare-kv-binding');
  const storage = createStorage({
    driver: cloudflareKV({ binding: env.GHDIFF }),
  });
  return {
    read: async () => storage.getItemRaw<string>(SERVED_KEY),
    write: async (value) => storage.setItemRaw(SERVED_KEY, value),
    keepAlive: (promise) => void waitUntil(promise),
  };
}

/**
 * The Node backend. The figure is held in the process and goes nowhere else —
 * an in-memory deployment simply restarts the count at zero, which a footer
 * estimate is allowed to do. The flush floats: the process outlives the
 * request, and the report is what a rejection would otherwise lose.
 */
function memoryBackend(): ServedBackend {
  const storage = createStorage();
  return {
    read: () => storage.getItemRaw<string>(SERVED_KEY),
    write: (value) => storage.setItemRaw(SERVED_KEY, value),
    keepAlive(promise) {
      promise.catch((error: unknown) => {
        console.error('served-count flush failed', error);
      });
    },
  };
}

/**
 * Which backend this bundle gets, answered at build time and folded by
 * dead-code elimination: the Cloudflare build drops the in-memory branch, the
 * Node build drops `cloudflareBackend()` and its imports with it. KV exists
 * only where the build says `cloudflare`; the self-hosted server and the
 * tests (whose runner writes no `import.meta.env`) share the in-memory one.
 */
export async function servedBackend(): Promise<ServedBackend> {
  return import.meta.env?.VITE_GHDIFF_TARGET === 'cloudflare'
    ? await cloudflareBackend()
    : memoryBackend();
}
