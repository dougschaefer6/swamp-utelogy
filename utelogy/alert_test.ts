import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  type DataHandle,
  type MethodContext,
  type UtelogyGlobalArgs,
  UtelogyGlobalArgsSchema,
  utelogyList,
} from "./_client.ts";
import { model, redactPacket } from "./alert.ts";

const g: UtelogyGlobalArgs = {
  apiKey: "test-key",
  authorization: "test-auth",
  baseUrl: "https://utelogy.example.com",
};

/** Swap `globalThis.fetch` for a stub that records request paths. */
function mockFetch(
  calls: string[],
  handler: (path: string) => { status: number; body: unknown },
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const path = new URL(typeof input === "string" ? input : input.toString())
      .pathname;
    calls.push(path);
    const { status, body } = handler(path);
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

/** A fake context that records writes and validates them against the spec schema. */
function fakeContext() {
  const writes: Array<
    { spec: string; name: string; data: Record<string, unknown> }
  > = [];
  const ctx: MethodContext = {
    globalArgs: g,
    logger: { info: () => {} },
    writeResource: (spec, name, data): Promise<DataHandle> => {
      const resources = model.resources as Record<
        string,
        { schema: { parse: (d: unknown) => unknown } }
      >;
      resources[spec].schema.parse(data);
      writes.push({ spec, name, data });
      return Promise.resolve({ name, specName: spec });
    },
    createFileWriter: () => {
      throw new Error("not used");
    },
  };
  return { ctx, writes };
}

const ack = model.methods.acknowledge;

Deno.test("acknowledge skips an alert the active list shows as acknowledged", async () => {
  const calls: string[] = [];
  const restore = mockFetch(calls, () => ({
    status: 200,
    body: [{
      _id: "a1",
      Acknowledged: true,
      AcknowledgeDate: "2026-10-08T12:00:00Z",
    }],
  }));
  try {
    const { ctx, writes } = fakeContext();
    await ack.execute({ id: "a1" }, ctx);
    assertEquals(calls, ["/api/alert/list/active"]);
    assertEquals(writes.length, 1);
    assertEquals(writes[0].spec, "acknowledgement");
    assertEquals(writes[0].data, {
      alertId: "a1",
      acknowledged: true,
      skipped: true,
      acknowledgedAt: "2026-10-08T12:00:00Z",
      response: null,
    });
  } finally {
    restore();
  }
});

Deno.test("acknowledge calls the endpoint and writes an acknowledgement", async () => {
  const calls: string[] = [];
  const restore = mockFetch(
    calls,
    (path) =>
      path.endsWith("/acknowledge")
        ? { status: 200, body: { ResponseCode: "Ok" } }
        : { status: 200, body: [{ _id: "a2", Acknowledged: false }] },
  );
  try {
    const { ctx, writes } = fakeContext();
    await ack.execute({ id: "a2" }, ctx);
    assertEquals(calls, [
      "/api/alert/list/active",
      "/api/alert/a2/acknowledge",
    ]);
    assertEquals(writes.length, 1);
    assertEquals(writes[0].spec, "acknowledgement");
    assertEquals(writes[0].name, "ack-a2");
    assertEquals(writes[0].data.skipped, false);
    assertEquals(writes[0].data.response, { ResponseCode: "Ok" });
    assert(typeof writes[0].data.acknowledgedAt === "string");
  } finally {
    restore();
  }
});

Deno.test("acknowledge throws on a pre-check 500 without acknowledging", async () => {
  const calls: string[] = [];
  const restore = mockFetch(calls, () => ({ status: 500, body: "boom" }));
  try {
    const { ctx, writes } = fakeContext();
    await assertRejects(
      () => ack.execute({ id: "a3" }, ctx),
      Error,
      "500",
    );
    assertEquals(calls, ["/api/alert/list/active"]);
    assertEquals(writes.length, 0);
  } finally {
    restore();
  }
});

Deno.test("acknowledge treats a 404 active list as empty and still acknowledges", async () => {
  const calls: string[] = [];
  const restore = mockFetch(
    calls,
    (path) =>
      path.endsWith("/acknowledge")
        ? { status: 200, body: { ResponseCode: "Ok" } }
        : { status: 404, body: {} },
  );
  try {
    const { ctx, writes } = fakeContext();
    await ack.execute({ id: "a4" }, ctx);
    assertEquals(calls.length, 2);
    assertEquals(writes[0].data.skipped, false);
  } finally {
    restore();
  }
});

Deno.test("acknowledge throws when the Packet response code is not Ok", async () => {
  const calls: string[] = [];
  const restore = mockFetch(
    calls,
    (path) =>
      path.endsWith("/acknowledge")
        ? { status: 200, body: { ResponseCode: "NotFound" } }
        : { status: 200, body: [] },
  );
  try {
    const { ctx, writes } = fakeContext();
    await assertRejects(
      () => ack.execute({ id: "a5" }, ctx),
      Error,
      "ResponseCode NotFound",
    );
    assertEquals(writes.length, 0);
  } finally {
    restore();
  }
});

Deno.test("utelogyList rejects a non-array body and names the path", async () => {
  const restore = mockFetch([], () => ({ status: 200, body: { Errors: {} } }));
  try {
    await assertRejects(
      () => utelogyList("/api/room/list", g),
      Error,
      "/api/room/list returned object",
    );
  } finally {
    restore();
  }
});

Deno.test("HTTP errors name the request path", async () => {
  const restore = mockFetch([], () => ({ status: 403, body: "denied" }));
  try {
    await assertRejects(
      () => utelogyList("/api/asset/list", g),
      Error,
      "on /api/asset/list",
    );
  } finally {
    restore();
  }
});

Deno.test("baseUrl must be https", () => {
  const bad = UtelogyGlobalArgsSchema.safeParse({
    ...g,
    baseUrl: "http://utelogy.example.com",
  });
  assert(!bad.success);
  assert(UtelogyGlobalArgsSchema.safeParse(g).success);
});

Deno.test("alert-api-reachable passes on the empty-list 404 and fails on a 500", async () => {
  const check = model.checks["alert-api-reachable"];
  for (const [status, pass] of [[404, true], [500, false]] as const) {
    const restore = mockFetch([], () => ({ status, body: {} }));
    try {
      const r = await check.execute({ globalArgs: g });
      assertEquals(r.pass, pass);
    } finally {
      restore();
    }
  }
});

Deno.test("acknowledge never stores Packet session or device secrets", () => {
  assertEquals(
    redactPacket({
      ResponseCode: "Ok",
      UserAuthKey: "k",
      SessionID: "s",
      MAC: "m",
    }),
    { ResponseCode: "Ok" },
  );
  assertEquals(redactPacket(null), null);
});
