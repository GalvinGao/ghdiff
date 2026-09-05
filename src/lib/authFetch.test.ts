import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { withRefresh } from './authFetch.ts';

// The retry, and the two things a refresh can come back with. `fetch` is stood
// in for by a Worker that answers the two auth routes as each case says, and a
// request is a script of statuses, one per send — so what is asserted is which
// routes were asked, how many times the request went out, and which answer came
// back to the caller.

const realFetch = globalThis.fetch;

interface Sent {
  url: string;
  method: string;
}

/** A Worker that answers the refresh and the sign-out with the statuses given. */
function worker(answers: { refresh: number; signout?: number }): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    sent.push({ url, method: init?.method ?? 'GET' });
    // A turn later, the way a network answers, so requests that fail together
    // all reach the refresh before it has come back.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (url === '/api/auth/refresh') {
      return new Response(null, { status: answers.refresh });
    }
    if (url === '/api/auth/signout') {
      return new Response(null, { status: answers.signout ?? 204 });
    }
    throw new Error(`Nothing answers ${url}.`);
  }) as typeof fetch;
  return sent;
}

/** A request whose answers are scripted, one status per send. */
function request(...statuses: number[]) {
  let sends = 0;
  return {
    send: (): Promise<Response> => {
      const status = statuses[sends];
      sends += 1;
      if (status == null) throw new Error('Sent more times than scripted.');
      return Promise.resolve(new Response('a body', { status }));
    },
    count: () => sends,
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('withRefresh', () => {
  it('returns any answer but 401 as it is, and asks for no refresh', async () => {
    const sent = worker({ refresh: 204 });
    const call = request(404);
    const response = await withRefresh(call.send);
    assert.equal(response.status, 404);
    assert.equal(call.count(), 1);
    assert.equal(sent.length, 0);
  });

  it('refreshes on a 401 and sends the request again', async () => {
    const sent = worker({ refresh: 204 });
    const call = request(401, 200);
    const response = await withRefresh(call.send);
    assert.equal(response.status, 200);
    assert.equal(call.count(), 2);
    assert.deepEqual(sent, [{ url: '/api/auth/refresh', method: 'POST' }]);
  });

  it('gives the 401 back when there is nothing left to refresh', async () => {
    // The refresh route has cleared the cookie on its way out, and the caller
    // is told what a signed-out reviewer should be told. Nothing is retried.
    const sent = worker({ refresh: 401 });
    const call = request(401);
    const response = await withRefresh(call.send);
    assert.equal(response.status, 401);
    assert.equal(call.count(), 1);
    assert.deepEqual(
      sent.map((s) => s.url),
      ['/api/auth/refresh']
    );
  });

  it('ends the session when the retry fails after a refresh that said 204', async () => {
    // A 204 with no cookie behind it is the refresh route's guess that another
    // tab won the race. A 401 on the retry is the proof it guessed wrong, and
    // the cookie would otherwise cost a refresh and an error on every load.
    const sent = worker({ refresh: 204 });
    const call = request(401, 401);
    const response = await withRefresh(call.send);
    assert.equal(response.status, 401);
    assert.equal(call.count(), 2);
    assert.deepEqual(sent, [
      { url: '/api/auth/refresh', method: 'POST' },
      { url: '/api/auth/signout', method: 'POST' },
    ]);
  });

  it('shares one refresh among requests that fail together', async () => {
    const sent = worker({ refresh: 204 });
    const calls = [request(401, 200), request(401, 200), request(401, 200)];
    const answers = await Promise.all(
      calls.map((call) => withRefresh(call.send))
    );
    assert.deepEqual(
      answers.map((response) => response.status),
      [200, 200, 200]
    );
    assert.equal(sent.filter((s) => s.url === '/api/auth/refresh').length, 1);
  });

  it('ends the session once, however many retries fail together', async () => {
    const sent = worker({ refresh: 204 });
    const calls = [request(401, 401), request(401, 401)];
    await Promise.all(calls.map((call) => withRefresh(call.send)));
    assert.equal(sent.filter((s) => s.url === '/api/auth/signout').length, 1);
  });

  it('neither refreshes nor retries a request its caller has abandoned', async () => {
    const sent = worker({ refresh: 204 });
    const controller = new AbortController();
    const call = request(401, 200);
    const send = () => {
      const answer = call.send();
      controller.abort();
      return answer;
    };
    const response = await withRefresh(send, controller.signal);
    assert.equal(response.status, 401);
    assert.equal(call.count(), 1);
    assert.equal(sent.length, 0);
  });
});
