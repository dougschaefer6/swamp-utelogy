import { z } from "npm:zod@4.3.6";

/**
 * Shared Utelogy API client and schemas for extension models.
 *
 * Credentials are passed via globalArguments, typically resolved from vault:
 *   apiKey:        ${{ vault.get(<client-vault>, utelogy-api-key) }}
 *   authorization: ${{ vault.get(<client-vault>, utelogy-authorization) }}
 */

export const UtelogyGlobalArgsSchema = z.object({
  apiKey: z.string().meta({ sensitive: true }).describe(
    "Utelogy API key. Use: ${{ vault.get(<client-vault>, utelogy-api-key) }}",
  ),
  authorization: z.string().meta({ sensitive: true }).describe(
    "Base64 authorization value. Use: ${{ vault.get(<client-vault>, utelogy-authorization) }}",
  ),
  baseUrl: z
    .string()
    .default("https://portal.utelogy.com")
    .refine((u) => u.toLowerCase().startsWith("https://"), {
      message: "baseUrl must use https:// (credentials travel in headers)",
    })
    .describe("Utelogy portal base URL (https only)"),
});

export type UtelogyGlobalArgs = z.infer<typeof UtelogyGlobalArgsSchema>;

/** Reference returned by `writeResource`, returned from a method's execute. */
export interface DataHandle {
  name: string;
  specName: string;
}

/** The subset of the swamp method context these models use. */
export interface MethodContext {
  globalArgs: UtelogyGlobalArgs;
  logger: {
    info: (msg: string, props?: Record<string, unknown>) => void;
  };
  writeResource: (
    spec: string,
    instance: string,
    data: Record<string, unknown>,
  ) => Promise<DataHandle>;
  createFileWriter: (
    spec: string,
    instance: string,
    opts: { contentType: string; tags?: Record<string, string> },
  ) => { writeAll: (bytes: Uint8Array) => Promise<DataHandle> };
}

/** Default per-request timeout; a hung portal fails the method instead of the lock. */
export const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Error thrown by {@link utelogyApi} on a non-2xx response. Carries the HTTP
 * status so callers can branch on it without matching message text.
 */
export class UtelogyApiError extends Error {
  /** HTTP status code of the failed response. */
  readonly status: number;

  /**
   * @param status - HTTP status code of the failed response
   * @param message - full error message
   */
  constructor(status: number, message: string) {
    super(message);
    this.name = "UtelogyApiError";
    this.status = status;
  }
}

/**
 * True when `err` is a Utelogy API error with HTTP status 404.
 *
 * @param err - any caught value
 * @returns whether the failed call returned 404 Not Found
 */
export function isNotFound(err: unknown): boolean {
  return err instanceof UtelogyApiError && err.status === 404;
}

export async function utelogyApi(
  path: string,
  globalArgs: { apiKey: string; authorization: string; baseUrl: string },
  params?: Record<string, string>,
): Promise<unknown> {
  const url = new URL(path, globalArgs.baseUrl);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const auth = globalArgs.authorization.startsWith("Basic ")
    ? globalArgs.authorization
    : `Basic ${globalArgs.authorization}`;

  let resp: Response;
  try {
    resp = await fetch(url.toString(), {
      headers: {
        "Authorization": auth,
        "api_key": globalArgs.apiKey,
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // Only the path is reported; credentials travel in headers and never
    // appear in the message.
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error(
        `Utelogy API ${url.pathname} timed out after ${REQUEST_TIMEOUT_MS}ms`,
      );
    }
    throw new Error(
      `Utelogy API ${url.pathname} request failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (!resp.ok) {
    const body = await resp.text();
    throw new UtelogyApiError(
      resp.status,
      `Utelogy API ${resp.status} ${resp.statusText} on ${url.pathname}: ${body}`,
    );
  }

  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    const contentType = resp.headers.get("content-type") ?? "(none)";
    throw new Error(
      `Utelogy API ${url.pathname} returned a non-JSON body (content-type ${contentType}, ${text.length} chars): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Call a Utelogy list endpoint and require a JSON array body. An object or
 * error-envelope body fails with the path named instead of surfacing later
 * as `count: undefined` or a TypeError.
 *
 * @param path - API path, e.g. `/api/alert/list/active`
 * @param globalArgs - credentials and base URL
 * @param params - optional query parameters
 * @returns the array body
 */
export async function utelogyList(
  path: string,
  globalArgs: { apiKey: string; authorization: string; baseUrl: string },
  params?: Record<string, string>,
): Promise<Array<Record<string, unknown>>> {
  const body = await utelogyApi(path, globalArgs, params);
  if (!Array.isArray(body)) {
    throw new Error(
      `Utelogy API ${path} returned ${
        body === null ? "null" : typeof body
      } where a JSON array was expected`,
    );
  }
  return body as Array<Record<string, unknown>>;
}

export function sanitizeId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

/**
 * First 8 hex characters of the SHA-256 of `value`. Appended to a sanitized
 * data name so inputs that sanitize identically (case, punctuation) still
 * land under distinct names.
 */
export async function shortHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest).slice(0, 4))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
