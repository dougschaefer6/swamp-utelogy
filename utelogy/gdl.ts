import { z } from "npm:zod@4.3.6";
import {
  type MethodContext,
  sanitizeId,
  shortHash,
  utelogyApi,
  UtelogyGlobalArgsSchema,
} from "./_client.ts";

const GdlEntrySchema = z.object({
  kind: z.string(),
  count: z.number(),
  items: z.array(z.unknown()),
  capturedAt: z.string(),
}).passthrough();

const DriverSearchSchema = z.object({
  keywords: z.string(),
  count: z.number(),
  results: z.array(z.unknown()),
  capturedAt: z.string(),
}).passthrough();

// Gdl_DriverFileGet returns the driver file itself: Swagger declares the 200
// body as `{type: string, format: byte}`, i.e. base64 file content. The
// decoded file is persisted through the `driverFile` files spec; this
// resource keeps only the metadata about it.
const DriverDetailSchema = z.object({
  filename: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  contentType: z.string(),
  fileDataName: z.string(),
  capturedAt: z.string(),
});

/** The base64 driver file body returned by `GET /api/gdl/driver/{filename}`. */
const DriverFileBodySchema = z.string();

/** Largest decoded driver file getDriver will persist. */
export const MAX_DRIVER_FILE_BYTES = 25 * 1024 * 1024;

// Path segments that would resolve to a different route once placed in
// /api/gdl/driver/{filename}: encodeURIComponent leaves dot segments intact,
// and `list` / `search` are sibling routes.
const RESERVED_DRIVER_FILENAMES = new Set([".", "..", "list", "search"]);

export const DriverFilenameSchema = z
  .string()
  .min(1)
  .refine((f) => !/[\\/]/.test(f), {
    message: "Driver filename must not contain '/' or '\\'",
  })
  .refine((f) => !RESERVED_DRIVER_FILENAMES.has(f.toLowerCase()), {
    message: "Driver filename must not be '.', '..', 'list' or 'search'",
  })
  .describe("GDL driver filename");

/**
 * Collision-free data-name stem for one driver filename: the sanitized
 * filename for readability plus an 8-hex hash of the raw filename, so
 * `Codec.xml`, `codec-xml` and `CODEC_xml` stay distinct.
 */
export async function driverDataStem(filename: string): Promise<string> {
  return `${sanitizeId(filename)}-${await shortHash(filename)}`;
}

function driverContentType(filename: string): string {
  return /\.xml$/i.test(filename)
    ? "application/xml"
    : "application/octet-stream";
}

/** Decode the base64 driver body, enforcing MAX_DRIVER_FILE_BYTES. */
export function decodeDriverFile(filename: string, b64: string): Uint8Array {
  // Bound the work before decoding: base64 is 4 chars per 3 bytes.
  if (b64.length > Math.ceil(MAX_DRIVER_FILE_BYTES / 3) * 4 + 4) {
    throw new Error(
      `Driver file ${filename} exceeds the ${MAX_DRIVER_FILE_BYTES}-byte cap (base64 body is ${b64.length} chars)`,
    );
  }
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    throw new Error(
      `Driver file ${filename}: response body is not valid base64`,
    );
  }
  if (binary.length > MAX_DRIVER_FILE_BYTES) {
    throw new Error(
      `Driver file ${filename} is ${binary.length} bytes, over the ${MAX_DRIVER_FILE_BYTES}-byte cap`,
    );
  }
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * `@dougschaefer/utelogy-gdl` model — read-only access to Utelogy's
 * Global Device Library, the canonical catalog of supported
 * manufacturers, device kinds (codecs, displays, microphones, control
 * processors, etc.), and feature kinds (capabilities). Use these
 * enumerations to validate or shape device records before they post
 * upstream — they reflect Utelogy's current driver coverage, not an
 * arbitrary catalog.
 */
export const model = {
  type: "@dougschaefer/utelogy-gdl",
  version: "2026.10.07.1",
  globalArguments: UtelogyGlobalArgsSchema,
  upgrades: [
    {
      toVersion: "2026.10.07.1",
      description:
        "Adds getDriver, the driverDetail resource and the driverFile files spec; globalArguments unchanged",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
  ],
  resources: {
    gdlEntry: {
      description:
        "A catalog collection from the Utelogy Global Device Library (manufacturers, device kinds, feature kinds, or drivers)",
      schema: GdlEntrySchema,
      lifetime: "7d",
      garbageCollection: 5,
    },
    driverSearch: {
      description: "Result of a driver keyword search in the GDL",
      schema: DriverSearchSchema,
      lifetime: "7d",
      garbageCollection: 5,
    },
    driverDetail: {
      description:
        "Metadata for a GDL driver file fetched by getDriver: filename, decoded byte size, content type, and the driverFile data name holding the file",
      schema: DriverDetailSchema,
      lifetime: "7d",
      garbageCollection: 5,
    },
  },
  files: {
    driverFile: {
      description:
        "The decoded GDL driver file returned by getDriver, tagged with its original filename",
      contentType: "application/octet-stream",
      lifetime: "7d" as const,
      garbageCollection: 5,
    },
  },
  methods: {
    listManufacturers: {
      description:
        "List all manufacturers in the Utelogy Global Device Library.",
      arguments: z.object({}),
      execute: async (_args: unknown, context: MethodContext) => {
        const g = context.globalArgs;
        const manufacturers = await utelogyApi(
          "/api/gdl/manufacturer/list",
          g,
        );

        const list = manufacturers as Array<Record<string, unknown>>;
        context.logger.info("Found {count} manufacturers", {
          count: list.length,
        });

        const handle = await context.writeResource(
          "gdlEntry",
          "manufacturers",
          {
            kind: "manufacturers",
            count: list.length,
            items: list,
            capturedAt: new Date().toISOString(),
          },
        );

        return { dataHandles: [handle] };
      },
    },

    listDeviceKinds: {
      description: "List all device kinds (categories) in the GDL.",
      arguments: z.object({}),
      execute: async (_args: unknown, context: MethodContext) => {
        const g = context.globalArgs;
        const kinds = await utelogyApi("/api/gdl/devicekind/list", g);

        const list = kinds as Array<Record<string, unknown>>;
        context.logger.info("Found {count} device kinds", {
          count: list.length,
        });

        const handle = await context.writeResource("gdlEntry", "device-kinds", {
          kind: "deviceKinds",
          count: list.length,
          items: list,
          capturedAt: new Date().toISOString(),
        });

        return { dataHandles: [handle] };
      },
    },

    listFeatureKinds: {
      description:
        "List all feature kinds (capabilities like power, volume, input) in the GDL.",
      arguments: z.object({}),
      execute: async (_args: unknown, context: MethodContext) => {
        const g = context.globalArgs;
        const kinds = await utelogyApi("/api/gdl/featurekind/list", g);

        const list = kinds as Array<Record<string, unknown>>;
        context.logger.info("Found {count} feature kinds", {
          count: list.length,
        });

        const handle = await context.writeResource(
          "gdlEntry",
          "feature-kinds",
          {
            kind: "featureKinds",
            count: list.length,
            items: list,
            capturedAt: new Date().toISOString(),
          },
        );

        return { dataHandles: [handle] };
      },
    },

    listDrivers: {
      description: "List all device drivers in the Global Device Library.",
      arguments: z.object({}),
      execute: async (_args: unknown, context: MethodContext) => {
        const g = context.globalArgs;
        const drivers = await utelogyApi("/api/gdl/driver/list", g);

        const list = drivers as Array<Record<string, unknown>>;
        context.logger.info("Found {count} drivers", { count: list.length });

        const handle = await context.writeResource("gdlEntry", "drivers", {
          kind: "drivers",
          count: list.length,
          items: list,
          capturedAt: new Date().toISOString(),
        });

        return { dataHandles: [handle] };
      },
    },

    searchDrivers: {
      description:
        "Search for device drivers by keyword (manufacturer, model, etc.).",
      arguments: z.object({
        keywords: z.string().describe("Search keywords for driver lookup"),
      }),
      execute: async (args: { keywords: string }, context: MethodContext) => {
        const g = context.globalArgs;
        const results = await utelogyApi(
          `/api/gdl/driver/search/${encodeURIComponent(args.keywords)}`,
          g,
        );

        const list = results as Array<Record<string, unknown>>;
        context.logger.info("Driver search for '{keywords}': {count} results", {
          keywords: args.keywords,
          count: list.length,
        });

        const handle = await context.writeResource(
          "driverSearch",
          `driver-search-${sanitizeId(args.keywords)}`,
          {
            keywords: args.keywords,
            count: list.length,
            results: list,
            capturedAt: new Date().toISOString(),
          },
        );

        return { dataHandles: [handle] };
      },
    },

    getDriver: {
      description:
        "Download one driver file from the GDL by filename (as returned by listDrivers or searchDrivers). The API returns the file base64-encoded; the decoded file is stored in driverFile and its metadata in driverDetail.",
      arguments: z.object({
        filename: DriverFilenameSchema,
      }),
      execute: async (args: { filename: string }, context: MethodContext) => {
        const g = context.globalArgs;
        const body = await utelogyApi(
          `/api/gdl/driver/${encodeURIComponent(args.filename)}`,
          g,
        );

        const parsed = DriverFileBodySchema.safeParse(body);
        if (!parsed.success) {
          throw new Error(
            `Driver file ${args.filename}: expected a base64 string body, got ${
              Array.isArray(body) ? "array" : typeof body
            }`,
          );
        }
        const bytes = decodeDriverFile(args.filename, parsed.data);
        const contentType = driverContentType(args.filename);
        const stem = await driverDataStem(args.filename);
        const fileDataName = `driver-file-${stem}`;

        context.logger.info("Retrieved driver {filename} ({bytes} bytes)", {
          filename: args.filename,
          bytes: bytes.length,
        });

        const fileHandle = await context
          .createFileWriter("driverFile", fileDataName, {
            contentType,
            tags: { filename: args.filename },
          })
          .writeAll(bytes);

        const handle = await context.writeResource(
          "driverDetail",
          `driver-detail-${stem}`,
          {
            filename: args.filename,
            sizeBytes: bytes.length,
            contentType,
            fileDataName,
            capturedAt: new Date().toISOString(),
          },
        );

        return { dataHandles: [fileHandle, handle] };
      },
    },
  },
};
