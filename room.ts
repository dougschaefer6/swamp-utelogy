import { z } from "npm:zod@4";
import { sanitizeId, utelogyApi, UtelogyGlobalArgsSchema } from "./_client.ts";

const MetricSchema = z.object({
  MetricKey: z.string(),
  Value: z.string(),
  Timestamp: z.string(),
  LastReportedTimestamp: z.string(),
  IsOverridden: z.boolean(),
}).passthrough();

const AlertSummarySchema = z.object({
  _id: z.string(),
  Severity: z.string(),
  Subject: z.string(),
  Message: z.string(),
  State: z.string(),
  Occurred: z.string(),
  Acknowledged: z.boolean(),
  AlertKind: z.string(),
  TargetInfo: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const ClmServiceSchema = z.object({
  ClmID: z.string(),
  StatusTimestamp: z.string(),
  IsReporting: z.boolean(),
  HostName: z.string(),
  ExecState: z.string(),
}).passthrough();

const RoomSchema = z.object({
  _id: z.string(),
  AccountKey: z.string(),
  Name: z.string(),
  ClmName: z.string(),
  IsPool: z.boolean(),
  IsManual: z.boolean(),
  ClmService: ClmServiceSchema.nullable(),
  ScheduleService: z.unknown().nullable(),
  LocationID: z.string().nullable(),
  LocationName: z.string().nullable(),
  Metrics: z.array(MetricSchema),
  Alerts: z.array(AlertSummarySchema),
}).passthrough();

export const model = {
  type: "@dougschaefer/utelogy-room",
  version: "2026.03.09.1",
  globalArguments: UtelogyGlobalArgsSchema,
  resources: {
    room: {
      description:
        "Utelogy-monitored room with CLM status, metrics, and alerts",
      schema: RoomSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all rooms in the Utelogy portal with metrics, CLM status, and active alerts.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const rooms = (await utelogyApi("/api/room/list", g)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} rooms", { count: rooms.length });

        const handles = [];
        for (const room of rooms) {
          const name = sanitizeId(room.Name as string || room._id as string);
          const handle = await context.writeResource("room", name, room);
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get detailed information about a specific room by ID.",
      arguments: z.object({
        id: z.string().describe("Utelogy room ID"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const room = (await utelogyApi(
          `/api/room/${encodeURIComponent(args.id)}`,
          g,
        )) as Record<string, unknown>;

        const name = sanitizeId(room.Name as string || args.id);
        const handle = await context.writeResource("room", name, room);

        context.logger.info("Retrieved room {name}", { name: room.Name });

        return { dataHandles: [handle] };
      },
    },

    getAlerts: {
      description: "List active alerts for a specific room.",
      arguments: z.object({
        id: z.string().describe("Utelogy room ID"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const alerts = await utelogyApi(
          `/api/room/${encodeURIComponent(args.id)}/alerts`,
          g,
        );

        const alertList = alerts as Array<Record<string, unknown>>;
        context.logger.info("Found {count} alerts for room {id}", {
          count: alertList.length,
          id: args.id,
        });

        return {
          data: {
            attributes: { roomId: args.id, alerts: alertList },
            name: `room-alerts-${sanitizeId(args.id)}`,
          },
        };
      },
    },
  },
};
