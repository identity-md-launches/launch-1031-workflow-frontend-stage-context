import { test } from "node:test";
import assert from "node:assert/strict";
import {
  apiJSON,
  BUSY_BACKOFF_MS,
  latestRequest,
  loadEvidence,
  oracleError,
  question,
  resolveRequest,
} from "../src/oracle";
const id = "4a3fa40e-32c7-49d1-9a2c-08c30495a2a6",
  jobId = "139f66e5-3cca-455d-8bd9-39aa393e7b3d";
const respond = (body: any, status = 200) =>
  new Response(JSON.stringify(body), { status });
const fetcher = (fn: (url: string) => Promise<Response> | Response) =>
  ((input: any) => Promise.resolve(fn(String(input)))) as typeof fetch;
test("busy replies, including HTTP 200, retry five times with bounded exponential backoff", async () => {
  let calls = 0;
  const waits: number[] = [],
    messages: string[] = [];
  const got = await apiJSON(
    "/oracle/requests?limit=1",
    undefined,
    fetcher(() =>
      ++calls <= 5
        ? respond(
            { error: "busy", message: "Oracle queue is full." },
            calls % 2 ? 200 : 503,
          )
        : respond({ requests: [] }),
    ),
    {
      wait: async (ms) => {
        waits.push(ms);
      },
      onRetry: (s) => messages.push(s),
    },
  );
  assert.equal(calls, 6);
  assert.deepEqual(waits, [...BUSY_BACKOFF_MS]);
  assert.deepEqual(got, { requests: [] });
  assert.equal(messages.length, 5);
  assert.match(messages[4], /Oracle queue is full.*5 of 5.*16 seconds/);
});
test("exhausted busy retries preserve the API message and offer recovery", async () => {
  let calls = 0;
  await assert.rejects(
    apiJSON(
      "/oracle/requests?limit=1",
      undefined,
      fetcher(() => {
        calls++;
        return respond({ error: "busy" });
      }),
      { wait: async () => {} },
    ),
    /oracle service is busy.*after 5 retries.*Try again/,
  );
  assert.equal(calls, 6);
});
test("service failures in HTTP 200 are surfaced, not treated as a pending panel", async () => {
  await assert.rejects(
    apiJSON(
      "/oracle/requests?limit=1",
      undefined,
      fetcher(() =>
        respond({
          error: "unavailable",
          message: "Oracle reads are temporarily disabled.",
        }),
      ),
    ),
    /reads are temporarily disabled/,
  );
});
test("browser network errors never surface Load failed or Failed to fetch", async () => {
  for (const message of [
    "Load failed",
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
  ]) {
    await assert.rejects(
      apiJSON(
        "/oracle/requests?limit=1",
        undefined,
        fetcher(() => {
          throw new TypeError(message);
        }),
        { wait: async () => {} },
      ),
      /could not be reached from this browser/,
    );
    assert.doesNotMatch(
      oracleError(new Error(message)),
      /Load failed|Failed to fetch/,
    );
  }
});
test("invalid JSON produces a recoverable service response error", async () => {
  await assert.rejects(
    apiJSON(
      "/oracle/requests?limit=1",
      undefined,
      fetcher(() => new Response("<html>unavailable</html>", { status: 502 })),
    ),
    /unreadable response.*502/,
  );
});
test("abort stops backoff and prevents further requests", async () => {
  const c = new AbortController();
  let calls = 0;
  await assert.rejects(
    apiJSON(
      "/oracle/requests?limit=1",
      undefined,
      fetcher(() => {
        calls++;
        return respond({ error: "busy" });
      }),
      {
        signal: c.signal,
        wait: async () => {
          c.abort();
        },
      },
    ),
    /abort/i,
  );
  assert.equal(calls, 1);
});
test("resolve request UUID and job UUID case-insensitively to the canonical request", async () => {
  const f = fetcher(() => respond({ requests: [{ id, jobId }] }));
  assert.equal(await resolveRequest(id.toUpperCase(), f), id);
  assert.equal(await resolveRequest(jobId.toUpperCase(), f), id);
});
test("older requests get one bounded larger-list lookup before direct detail", async () => {
  const calls: string[] = [];
  const f = fetcher((url) => {
    calls.push(url);
    return respond({
      requests: url.endsWith("limit=1000") ? [{ id, jobId }] : [],
    });
  });
  assert.equal(await resolveRequest(jobId, f), id);
  assert.equal(calls.length, 2);
});
test("latest matching request requires exact question and mainnet, with no manual paste", async () => {
  const f = fetcher(() =>
    respond({
      requests: [
        {
          id,
          question: question("floor"),
          chainId: 1,
          createdAt: "2026-10-09T18:00:00Z",
        },
        {
          id: jobId,
          question: question("cap"),
          chainId: 1,
          createdAt: "2026-10-09T19:00:00Z",
        },
      ],
    }),
  );
  assert.equal(await latestRequest("floor", f), id);
  await assert.rejects(
    latestRequest(
      "floor",
      fetcher(() => respond({ requests: [] })),
    ),
    /Buy the question/,
  );
});
test("pending returns undefined; failed/refused/cancelled request preserves service explanation", async () => {
  for (const status of ["pending", "failed", "refused", "cancelled"]) {
    const f = fetcher((url) =>
      respond(
        url.includes("?")
          ? { requests: [{ id, jobId }] }
          : {
              id,
              status,
              failure:
                status === "pending" ? null : "Not enough panel members.",
            },
      ),
    );
    if (status === "pending")
      assert.equal(await loadEvidence(id, f), undefined);
    else await assert.rejects(loadEvidence(id, f), /Not enough panel members/);
  }
});
test("attested responses cannot silently omit evidence or substitute another request", async () => {
  for (const detail of [
    { id, status: "attested" },
    { id: jobId, status: "attested" },
  ]) {
    await assert.rejects(
      loadEvidence(
        id,
        fetcher((url) =>
          respond(url.includes("?") ? { requests: [{ id }] } : detail),
        ),
      ),
      /not supplied|different request/,
    );
  }
});

test("transient browser transport failure retries without a CORS proxy", async () => {
  let calls = 0;
  const waits: number[] = [];
  const body = await apiJSON(
    "/oracle/requests?limit=1",
    undefined,
    fetcher(() => {
      if (++calls === 1) throw new TypeError("Failed to fetch");
      return respond({ requests: [] });
    }),
    {
      wait: async (ms) => {
        waits.push(ms);
      },
    },
  );
  assert.equal(calls, 2);
  assert.deepEqual(waits, [1000]);
  assert.deepEqual(body, { requests: [] });
});
