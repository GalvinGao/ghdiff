import { buildReviewData, type ReviewData } from './reviewData.ts';

interface ParsedPatch {
  body: string;
  cacheKey: string;
  untracked: ReadonlySet<string> | undefined;
  data: ReviewData;
}

const MAX_CACHED_PARSES = 3;

/**
 * A mounted review's parse, owned weakly by its raw query response. Keeping a
 * query fresh keeps its parse reusable, including hydrated metadata. Expiring
 * the response lets both go; there is no second five-minute retention timer.
 * Keep at most three recently used parses, so navigating through many fresh
 * queries cannot retain parsed line arrays for every review.
 * One cache belongs to one QueryClient, so SSR requests and app sessions do
 * not share response identities. Prefetch only downloads and never calls get.
 */
export class ReviewParseCache {
  private readonly byResponse = new WeakMap<object, ParsedPatch>();
  private recent: WeakRef<object>[] = [];

  private touch(response: object): void {
    this.recent = this.recent.filter((reference) => {
      const held = reference.deref();
      return held != null && held !== response;
    });
    this.recent.push(new WeakRef(response));
    if (this.recent.length > MAX_CACHED_PARSES) {
      const evicted = this.recent.shift()?.deref();
      if (evicted != null) this.byResponse.delete(evicted);
    }
  }

  get(
    response: { readonly body: string },
    cacheKey: string,
    untracked?: ReadonlySet<string>
  ): ReviewData {
    const cached = this.byResponse.get(response);
    if (
      cached?.body === response.body &&
      cached.cacheKey === cacheKey &&
      cached.untracked === untracked
    ) {
      this.touch(response);
      return cached.data;
    }
    const data = buildReviewData(response.body, cacheKey, untracked);
    this.byResponse.set(response, {
      body: response.body,
      cacheKey,
      untracked,
      data,
    });
    this.touch(response);
    return data;
  }
}
