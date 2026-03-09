import { z } from "npm:zod@4";
import { sanitizeId, utelogyApi, UtelogyGlobalArgsSchema } from "./_client.ts";

const AssetSchema = z.object({
  _id: z.string(),
  AccountKey: z.string(),
}).passthrough();

export const model = {
  type: "@dougschaefer/utelogy-asset",
  version: "2026.03.09.1",
  globalArguments: UtelogyGlobalArgsSchema,
  resources: {
    asset: {
      description:
        "Utelogy-monitored asset (AV device, compute endpoint, etc.)",
      schema: AssetSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description: "List all monitored assets (devices) across all rooms.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const assets = (await utelogyApi("/api/asset/list", g)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} assets", { count: assets.length });

        const handles = [];
        for (const asset of assets) {
          const name = sanitizeId(asset._id as string);
          const handle = await context.writeResource("asset", name, asset);
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get detailed information about a specific asset by ID.",
      arguments: z.object({
        id: z.string().describe("Utelogy asset ID"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const asset = (await utelogyApi(
          `/api/asset/${encodeURIComponent(args.id)}`,
          g,
        )) as Record<string, unknown>;

        const name = sanitizeId(args.id);
        const handle = await context.writeResource("asset", name, asset);

        context.logger.info("Retrieved asset {id}", { id: args.id });

        return { dataHandles: [handle] };
      },
    },
  },
};
