import { z } from "npm:zod@4.3.6";
import { sanitizeId, utelogyApi, UtelogyGlobalArgsSchema } from "./_client.ts";

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
  version: "2026.05.26.1",
  globalArguments: UtelogyGlobalArgsSchema,
  resources: {},
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

        return {
          data: {
            attributes: { manufacturers: list },
            name: "manufacturers",
          },
        };
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

        return {
          data: {
            attributes: { deviceKinds: list },
            name: "device-kinds",
          },
        };
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

        return {
          data: {
            attributes: { featureKinds: list },
            name: "feature-kinds",
          },
        };
      },
    },

    listDrivers: {
      description: "List all device drivers in the Global Device Library.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const drivers = await utelogyApi("/api/gdl/driver/list", g);

        return {
          data: {
            attributes: { drivers },
            name: "drivers",
          },
        };
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

        context.logger.info("Driver search for '{keywords}'", {
          keywords: args.keywords,
        });

        return {
          data: {
            attributes: { keywords: args.keywords, results },
            name: `driver-search-${sanitizeId(args.keywords)}`,
          },
        };
      },
    },
  },
};
