import { z } from "npm:zod@4.3.6";
import { sanitizeId, utelogyApi, UtelogyGlobalArgsSchema } from "./_client.ts";

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
  version: "2026.05.27.1",
  globalArguments: UtelogyGlobalArgsSchema,
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
  },
  methods: {
    listManufacturers: {
      description:
        "List all manufacturers in the Utelogy Global Device Library.",
      arguments: z.object({}),
      execute: async (_args, context) => {
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
      execute: async (_args, context) => {
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
      execute: async (_args, context) => {
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
      execute: async (_args, context) => {
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
      execute: async (args, context) => {
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
  },
};
