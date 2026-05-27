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
    .describe("Utelogy portal base URL"),
});

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

  const resp = await fetch(url.toString(), {
    headers: {
      "Authorization": auth,
      "api_key": globalArgs.apiKey,
      "Accept": "application/json",
    },
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Utelogy API ${resp.status} ${resp.statusText}: ${body}`);
  }

  return resp.json();
}

export function sanitizeId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}
