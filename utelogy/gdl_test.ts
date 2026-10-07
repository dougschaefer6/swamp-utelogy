import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import type {
  DataHandle,
  MethodContext,
  UtelogyGlobalArgs,
} from "./_client.ts";
import { driverDataStem, MAX_DRIVER_FILE_BYTES, model } from "./gdl.ts";
import { model as alertModel } from "./alert.ts";
import { model as assetModel } from "./asset.ts";
import { model as roomModel } from "./room.ts";

const g: UtelogyGlobalArgs = {
  apiKey: "test-key",
  authorization: "test-auth",
  baseUrl: "https://utelogy.example.com",
};

/** Swap `globalThis.fetch` for a stub; returns a restore function. */
function mockFetch(
  handler: (
    url: string,
    init?: RequestInit,
  ) => { status: number; body: string },
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const { status, body } = handler(url, init);
    return Promise.resolve(new Response(body, { status }));
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

interface FileWrite {
  spec: string;
  name: string;
  opts: { contentType: string; tags?: Record<string, string> };
  bytes?: Uint8Array;
}

/** A fake method context that records every resource and file write. */
function fakeContext(): {
  ctx: MethodContext;
  writes: Array<{ spec: string; name: string; data: Record<string, unknown> }>;
  files: FileWrite[];
} {
  const writes: Array<
    { spec: string; name: string; data: Record<string, unknown> }
  > = [];
  const files: FileWrite[] = [];
  const ctx: MethodContext = {
    globalArgs: g,
    logger: { info: () => {} },
    writeResource: (spec, name, data): Promise<DataHandle> => {
      writes.push({ spec, name, data });
      return Promise.resolve({ name, specName: spec });
    },
    createFileWriter: (spec, name, opts) => {
      const entry: FileWrite = { spec, name, opts };
      files.push(entry);
      return {
        writeAll: (bytes: Uint8Array): Promise<DataHandle> => {
          entry.bytes = bytes;
          return Promise.resolve({ name, specName: spec });
        },
      };
    },
  };
  return { ctx, writes, files };
}

const DRIVER_XML = '<?xml version="1.0"?><Driver Name="Example Codec"/>';
const DRIVER_B64 = btoa(DRIVER_XML);

Deno.test("every utelogy model ends its upgrades chain at its version", () => {
  for (const m of [model, alertModel, assetModel, roomModel]) {
    assertEquals(m.version, "2026.10.07.1");
    const last = m.upgrades[m.upgrades.length - 1];
    assertEquals(last.toVersion, m.version);
    const old = { apiKey: "test-key", authorization: "test-auth" };
    assertEquals(last.upgradeAttributes(old), old);
  }
});

Deno.test("getDriver decodes the base64 driver file and writes file + metadata", async () => {
  let seenUrl = "";
  let seenHeaders: Headers | undefined;
  const restore = mockFetch((url, init) => {
    seenUrl = url;
    seenHeaders = new Headers(init?.headers);
    // The API returns the file as a JSON-encoded base64 string.
    return { status: 200, body: JSON.stringify(DRIVER_B64) };
  });
  try {
    const { ctx, writes, files } = fakeContext();
    const result = await model.methods.getDriver.execute(
      { filename: "Example Codec v2.xml" },
      ctx,
    );

    assertEquals(
      seenUrl,
      "https://utelogy.example.com/api/gdl/driver/Example%20Codec%20v2.xml",
    );
    assertEquals(seenHeaders?.get("api_key"), "test-key");
    assertEquals(seenHeaders?.get("Authorization"), "Basic test-auth");

    const stem = await driverDataStem("Example Codec v2.xml");
    assert(/^example-codec-v2-xml-[0-9a-f]{8}$/.test(stem), stem);

    assertEquals(files.length, 1);
    assertEquals(files[0].spec, "driverFile");
    assertEquals(files[0].name, `driver-file-${stem}`);
    assertEquals(files[0].opts.contentType, "application/xml");
    assertEquals(files[0].opts.tags, { filename: "Example Codec v2.xml" });
    assertEquals(new TextDecoder().decode(files[0].bytes), DRIVER_XML);

    assertEquals(writes.length, 1);
    assertEquals(writes[0].spec, "driverDetail");
    assertEquals(writes[0].name, `driver-detail-${stem}`);
    assertEquals(writes[0].data.filename, "Example Codec v2.xml");
    assertEquals(
      writes[0].data.sizeBytes,
      new TextEncoder().encode(DRIVER_XML).length,
    );
    assertEquals(writes[0].data.contentType, "application/xml");
    assertEquals(writes[0].data.fileDataName, `driver-file-${stem}`);
    assert(typeof writes[0].data.capturedAt === "string");
    assertEquals(result.dataHandles.length, 2);

    // The persisted record satisfies the resource schema, which does not
    // pass unknown keys through.
    const extra = model.resources.driverDetail.schema.parse({
      ...writes[0].data,
      extra: true,
    });
    assertEquals("extra" in extra, false);
  } finally {
    restore();
  }
});

Deno.test("getDriver names cannot collide with searchDrivers names", async () => {
  const restore = mockFetch((url) => ({
    status: 200,
    body: url.includes("/search/") ? "[]" : JSON.stringify(DRIVER_B64),
  }));
  try {
    const { ctx, writes, files } = fakeContext();
    await model.methods.getDriver.execute({ filename: "search-codec" }, ctx);
    await model.methods.searchDrivers.execute({ keywords: "codec" }, ctx);

    const names = [...writes.map((w) => w.name), ...files.map((f) => f.name)];
    assertEquals(names.length, 3);
    assertEquals(new Set(names).size, 3);
    assert(names.includes("driver-search-codec"));
  } finally {
    restore();
  }
});

Deno.test("getDriver keeps case/punctuation variants of a filename distinct", async () => {
  const restore = mockFetch(() => ({
    status: 200,
    body: JSON.stringify(DRIVER_B64),
  }));
  try {
    const { ctx, writes, files } = fakeContext();
    for (const filename of ["Codec.xml", "codec-xml", "CODEC_xml"]) {
      await model.methods.getDriver.execute({ filename }, ctx);
    }
    assertEquals(new Set(writes.map((w) => w.name)).size, 3);
    assertEquals(new Set(files.map((f) => f.name)).size, 3);
    for (const w of writes) {
      assert(/^driver-detail-codec-xml-[0-9a-f]{8}$/.test(w.name), w.name);
    }
  } finally {
    restore();
  }
});

Deno.test("getDriver rejects a non-string body and invalid base64", async () => {
  for (
    const [body, msg] of [
      [JSON.stringify({ FileName: "x.xml" }), "expected a base64 string"],
      [JSON.stringify("not*base64!"), "not valid base64"],
    ]
  ) {
    const restore = mockFetch(() => ({ status: 200, body }));
    try {
      const { ctx, writes, files } = fakeContext();
      await assertRejects(
        () => model.methods.getDriver.execute({ filename: "x.xml" }, ctx),
        Error,
        msg,
      );
      assertEquals(writes.length + files.length, 0);
    } finally {
      restore();
    }
  }
});

Deno.test("getDriver enforces the driver file size cap", async () => {
  // One byte over the cap, base64-encoded without building the bytes.
  const overB64 = "A".repeat(Math.ceil((MAX_DRIVER_FILE_BYTES + 1) / 3) * 4);
  const restore = mockFetch(() => ({
    status: 200,
    body: JSON.stringify(overB64),
  }));
  try {
    const { ctx, writes, files } = fakeContext();
    await assertRejects(
      () => model.methods.getDriver.execute({ filename: "big.xml" }, ctx),
      Error,
      "-byte cap",
    );
    assertEquals(writes.length + files.length, 0);
  } finally {
    restore();
  }
});

Deno.test("utelogyApi reports a non-JSON body with path and content-type, never the key", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response("<html>oops</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    )) as typeof fetch;
  try {
    const { ctx } = fakeContext();
    const err = await assertRejects(
      () => model.methods.listDrivers.execute({}, ctx),
      Error,
    );
    assert(err.message.includes("/api/gdl/driver/list"), err.message);
    assert(err.message.includes("text/html"), err.message);
    assert(!err.message.includes("test-key"), err.message);
    assert(!err.message.includes("test-auth"), err.message);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("getDriver surfaces API errors without writing", async () => {
  const restore = mockFetch(() => ({ status: 404, body: "not found" }));
  try {
    const { ctx, writes } = fakeContext();
    await assertRejects(
      () => model.methods.getDriver.execute({ filename: "missing.xml" }, ctx),
      Error,
      "Utelogy API 404",
    );
    assertEquals(writes.length, 0);
  } finally {
    restore();
  }
});

Deno.test("getDriver rejects an empty filename", () => {
  const parsed = model.methods.getDriver.arguments.safeParse({ filename: "" });
  assertEquals(parsed.success, false);
});

Deno.test("getDriver rejects filenames that escape the driver route", () => {
  for (
    const filename of [
      ".",
      "..",
      "list",
      "search",
      "LIST",
      "Search",
      "a/b.xml",
      "..\\x.xml",
      "../list",
    ]
  ) {
    const parsed = model.methods.getDriver.arguments.safeParse({ filename });
    assertEquals(parsed.success, false, filename);
  }
  for (const filename of ["Codec.xml", "list.xml", "...xml", "search-codec"]) {
    const parsed = model.methods.getDriver.arguments.safeParse({ filename });
    assertEquals(parsed.success, true, filename);
  }
});
