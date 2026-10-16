// Declarative request validation for the API routes, in the shape of Hono's
// zValidator: one factory, and the schema object names an input channel per
// key. A route puts `validate({ search: … })` — or `body` — in its
// `server.middleware` and its handler reads the parsed value off the typed
// context as `context.search` / `context.body`. An input that does not parse
// logs its outcome and is answered 400 before the handler runs.

import { createMiddleware } from '@tanstack/react-start';
import * as z from 'zod';

import { apiMiddleware } from './middleware';
import { textResponse } from './plainText';

/** What a route answers with when its input does not parse. */
export interface InvalidInput {
  /** The outcome the wide event records. */
  outcome: string;
  /** The 400's sentence. */
  message: string;
}

/** The channels a route's input can arrive on. */
type ChannelSchemas = {
  /** The query string, parsed as one record. */
  search?: z.ZodType;
  /** The JSON body. */
  body?: z.ZodType;
};

/**
 * One middleware that parses a route's declared channels and injects the
 * parsed values into the handler's context. It depends on `apiMiddleware`, so
 * a validating route gets the whole chain — the wide event and the deployment
 * config — by naming this one middleware. `onInvalid` shapes the failure: the
 * logged outcome and the 400's sentence.
 */
export function validate<S extends ChannelSchemas>(
  schema: S,
  onInvalid: (error: z.ZodError | undefined) => InvalidInput
) {
  return createMiddleware({ type: 'request' })
    .middleware([apiMiddleware])
    .server(async ({ request, context, next }) => {
      const input: Record<string, unknown> = {};
      if (schema.search != null) {
        input.search = Object.fromEntries(new URL(request.url).searchParams);
      }
      if (schema.body != null) {
        try {
          input.body = await request.json();
        } catch {
          const { outcome, message } = onInvalid(undefined);
          context.log.set({ outcome });
          return textResponse(message, {
            status: 400,
            failure: { reason: 'bad-request' },
          });
        }
      }
      const result = z.object(schema).safeParse(input);
      if (!result.success) {
        const { outcome, message } = onInvalid(result.error);
        context.log.set({ outcome });
        return textResponse(message, {
          status: 400,
          failure: { reason: 'bad-request' },
        });
      }
      return next({ context: result.data });
    });
}
