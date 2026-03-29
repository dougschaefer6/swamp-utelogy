import { z } from "npm:zod@4.3.6";
import { sanitizeId, utelogyApi, UtelogyGlobalArgsSchema } from "./_client.ts";

const TargetInfoSchema = z.object({
  Target: z.string(),
  TargetID: z.string(),
  Description: z.string(),
  ClmID: z.string(),
  DeviceKindCode: z.string(),
  ManufacturerCode: z.string(),
  RoomName: z.string(),
  RoomID: z.string(),
  DeviceKindName: z.string(),
  ManufacturerName: z.string(),
  AssetID: z.string(),
  SerialNumber: z.string(),
  Reference: z.string(),
  ModelName: z.string(),
}).passthrough();

const AlertSchema = z.object({
  _id: z.string(),
  AccountKey: z.string(),
  TargetInfo: TargetInfoSchema,
  State: z.string(),
  Subject: z.string(),
  Severity: z.string(),
  Message: z.string(),
  Occurred: z.string(),
  Cleared: z.string().nullable(),
  Acknowledged: z.boolean(),
  AcknowledgeUserID: z.string().nullable(),
  AcknowledgeUser: z.string().nullable(),
  AcknowledgeDate: z.string().nullable(),
  AlertKind: z.string(),
  Feature: z.string().nullable(),
  LocationID: z.string().nullable(),
  LocationName: z.string().nullable(),
}).passthrough();

export const model = {
  type: "@dougschaefer/utelogy-alert",
  version: "2026.03.09.1",
  globalArguments: UtelogyGlobalArgsSchema,
  resources: {
    alert: {
      description:
        "Utelogy alert with target info, severity, and acknowledgment state",
      schema: AlertSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    listActive: {
      description:
        "List all currently active (unacknowledged) alerts across all devices.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const alerts = (await utelogyApi(
          "/api/alert/list/active",
          g,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} active alerts", {
          count: alerts.length,
        });

        const handles = [];
        for (const alert of alerts) {
          const name = sanitizeId(alert._id as string);
          const handle = await context.writeResource("alert", name, alert);
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    list: {
      description: "List alerts with optional date range filter.",
      arguments: z.object({
        occurredFrom: z
          .string()
          .optional()
          .describe("Start date filter (ISO 8601 datetime)"),
        occurredTo: z
          .string()
          .optional()
          .describe("End date filter (ISO 8601 datetime)"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const params: Record<string, string> = {};
        if (args.occurredFrom) params.occurredFrom = args.occurredFrom;
        if (args.occurredTo) params.occurredTo = args.occurredTo;

        const alerts = (await utelogyApi(
          "/api/alert/list",
          g,
          params,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} alerts", { count: alerts.length });

        const handles = [];
        for (const alert of alerts) {
          const name = sanitizeId(alert._id as string);
          const handle = await context.writeResource("alert", name, alert);
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    acknowledge: {
      description: "Acknowledge an active alert by ID.",
      arguments: z.object({
        id: z.string().describe("The alert ID to acknowledge"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const result = await utelogyApi(
          `/api/alert/${encodeURIComponent(args.id)}/acknowledge`,
          g,
        );

        context.logger.info("Acknowledged alert {id}", { id: args.id });

        return {
          data: {
            attributes: { alertId: args.id, result },
            name: `ack-${sanitizeId(args.id)}`,
          },
        };
      },
    },
  },
};
