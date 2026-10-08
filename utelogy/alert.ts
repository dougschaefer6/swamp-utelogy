import { z } from "npm:zod@4.3.6";
import {
  isNotFound,
  type MethodContext,
  sanitizeId,
  utelogyApi,
  UtelogyGlobalArgsSchema,
  utelogyList,
} from "./_client.ts";

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

/** Result of an `acknowledge` call, kept apart from real alert records. */
const AcknowledgementSchema = z.object({
  alertId: z.string(),
  acknowledged: z.boolean(),
  skipped: z.boolean(),
  acknowledgedAt: z.string().nullable(),
  response: z.unknown().nullable(),
}).strict();

/** Packet response codes that mean the acknowledge request was accepted. */
const ACK_OK_CODES = new Set(["Ok", "Queued"]);

/**
 * `@dougschaefer/utelogy-alert` model — Utelogy alert lifecycle.
 * listActive returns currently-open alerts and is the primary feed for
 * triage and incident creation; List enumerates the broader alert
 * history with optional filters for retrospective analysis. Acknowledge
 * transitions an alert to acknowledged state via the alerts API — note
 * that Utelogy's read API is otherwise read-only, this is the only
 * supported mutation surface.
 */
/** Packet fields that carry session or device secrets; never stored. */
const PACKET_SECRET_FIELDS = ["UserAuthKey", "SessionID", "MAC"];

/** The acknowledge response with session and device secrets removed. */
export function redactPacket(response: unknown): unknown {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return response ?? null;
  }
  const copy = { ...(response as Record<string, unknown>) };
  for (const f of PACKET_SECRET_FIELDS) delete copy[f];
  return copy;
}

export const model = {
  type: "@dougschaefer/utelogy-alert",
  version: "2026.10.08.1",
  globalArguments: UtelogyGlobalArgsSchema,
  upgrades: [
    {
      toVersion: "2026.10.07.1",
      description:
        "Typed method context; gdl gains getDriver; globalArguments unchanged",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.10.08.1",
      description:
        "acknowledge writes an acknowledgement record and checks state via the active-alert list; globalArguments unchanged (baseUrl now must be https)",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
  ],
  resources: {
    alert: {
      description:
        "Utelogy alert with target info, severity, and acknowledgment state",
      schema: AlertSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    acknowledgement: {
      description:
        "Outcome of an acknowledge call: whether the alert was acknowledged, skipped as already acknowledged, and the API response",
      schema: AcknowledgementSchema,
      lifetime: "30d",
      garbageCollection: 10,
    },
  },
  methods: {
    listActive: {
      description:
        "List all currently active (unacknowledged) alerts across all devices.",
      arguments: z.object({}),
      execute: async (_args: unknown, context: MethodContext) => {
        const g = context.globalArgs;
        const alerts = await utelogyList(
          "/api/alert/list/active",
          g,
        );

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
      execute: async (
        args: { occurredFrom?: string; occurredTo?: string },
        context: MethodContext,
      ) => {
        const g = context.globalArgs;
        const params: Record<string, string> = {};
        if (args.occurredFrom) params.occurredFrom = args.occurredFrom;
        if (args.occurredTo) params.occurredTo = args.occurredTo;

        const alerts = await utelogyList(
          "/api/alert/list",
          g,
          params,
        );

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
      description:
        "Acknowledge an alert by ID. Looks the alert up in the active-alert list first and skips the call only when that list shows it already acknowledged; an alert absent from the list is sent to the acknowledge endpoint, which decides. Writes an acknowledgement record.",
      arguments: z.object({
        id: z.string().min(1).describe("The alert ID to acknowledge"),
      }),
      execute: async (args: { id: string }, context: MethodContext) => {
        const g = context.globalArgs;
        const ackPath = `/api/alert/${encodeURIComponent(args.id)}/acknowledge`;

        // The public API has no single-alert GET, so state comes from the
        // active list. Only a 404 (empty list) is tolerated; auth, 5xx and
        // timeout errors propagate rather than silently re-acknowledging.
        let active: Array<Record<string, unknown>> = [];
        try {
          active = await utelogyList("/api/alert/list/active", g);
        } catch (err) {
          if (!isNotFound(err)) throw err;
        }
        const existing = active.find((a) => a._id === args.id);

        if (existing?.Acknowledged === true) {
          context.logger.info("Alert {id} already acknowledged, no change", {
            id: args.id,
          });
          const handle = await context.writeResource(
            "acknowledgement",
            `ack-${sanitizeId(args.id)}`,
            {
              alertId: args.id,
              acknowledged: true,
              skipped: true,
              acknowledgedAt: typeof existing.AcknowledgeDate === "string"
                ? existing.AcknowledgeDate
                : null,
              response: null,
            },
          );
          return { dataHandles: [handle] };
        }

        context.logger.info("Acknowledging alert {id}", { id: args.id });
        const response = await utelogyApi(ackPath, g);
        const code = (response as { ResponseCode?: unknown } | null)
          ?.ResponseCode;
        if (typeof code === "string" && !ACK_OK_CODES.has(code)) {
          throw new Error(
            `Utelogy API ${ackPath} refused the acknowledge: ResponseCode ${code}`,
          );
        }
        context.logger.info("Acknowledged alert {id}", { id: args.id });

        const handle = await context.writeResource(
          "acknowledgement",
          `ack-${sanitizeId(args.id)}`,
          {
            alertId: args.id,
            acknowledged: true,
            skipped: false,
            acknowledgedAt: new Date().toISOString(),
            response: redactPacket(response),
          },
        );
        return { dataHandles: [handle] };
      },
    },
  },

  checks: {
    "alert-api-reachable": {
      description:
        "Verify the Utelogy alert API is reachable before acknowledging.",
      labels: ["live"],
      appliesTo: ["acknowledge"],
      execute: async (context: Pick<MethodContext, "globalArgs">) => {
        try {
          await utelogyApi("/api/alert/list/active", context.globalArgs);
          return { pass: true };
        } catch (err) {
          // The active list 404s when nothing is active; acknowledge treats
          // that as an empty list, so the API is reachable.
          if (isNotFound(err)) return { pass: true };
          return {
            pass: false,
            errors: [
              `Utelogy alert API unreachable: ${String(err)}`,
            ],
          };
        }
      },
    },
  },
};
