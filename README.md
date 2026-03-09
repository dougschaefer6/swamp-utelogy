# Swamp Utelogy Extension

[Swamp](https://swamp.club) extension models for the [Utelogy](https://www.utelogy.com) AV monitoring platform. Provides structured resource tracking for rooms, assets, alerts, and the Global Device Library.

## What It Does

Turns Utelogy API data into tracked Swamp resources with full lifecycle management — query, persist, version, and garbage-collect your AV monitoring data alongside the rest of your infrastructure state.

## Models

### `@dougschaefer/utelogy-room`

Rooms monitored by Utelogy with CLM (Connection Lifecycle Manager) status, metrics, and alert summaries.

**Resources:** `room` — persisted with infinite lifetime, GC after 10 versions

**Methods:**
- `list` — List all rooms, persists each as a tracked resource
- `get` — Get a specific room by ID
- `getAlerts` — List active alerts for a specific room

### `@dougschaefer/utelogy-asset`

Monitored assets (AV devices, compute endpoints, etc.) across all rooms.

**Resources:** `asset` — persisted with infinite lifetime, GC after 10 versions

**Methods:**
- `list` — List all assets, persists each as a tracked resource
- `get` — Get a specific asset by ID

### `@dougschaefer/utelogy-alert`

Alerts with full target info, severity levels, and acknowledgment state.

**Resources:** `alert` — persisted with infinite lifetime, GC after 10 versions

**Methods:**
- `listActive` — List all currently active (unacknowledged) alerts
- `list` — List alerts with optional date range filter
- `acknowledge` — Acknowledge an active alert by ID

### `@dougschaefer/utelogy-gdl`

Global Device Library reference data — manufacturers, device categories, feature capabilities, and drivers. No resource persistence (reference data only).

**Methods:**
- `listManufacturers` — List all manufacturers
- `listDeviceKinds` — List device categories
- `listFeatureKinds` — List feature capabilities (power, volume, input, etc.)
- `listDrivers` — List all drivers
- `searchDrivers` — Search drivers by keyword

## Prerequisites

- [Swamp CLI](https://swamp.club) installed (`curl -fsSL swamp.club/install.sh | sh`)
- A Utelogy portal account with API access
- Your Utelogy API key and Base64 authorization header stored in a Swamp vault

## Installation

```bash
swamp extension pull @dougschaefer/utelogy
```

## Credential Setup

Store your Utelogy credentials in a Swamp vault (one vault per client for MSP multi-tenancy):

```bash
# Create a vault for the client
swamp vault create my-client

# Store credentials
swamp vault put my-client/utelogy-api-key "your-api-key"
swamp vault put my-client/utelogy-authorization "your-base64-auth"
```

Then create a model instance referencing the vault:

```yaml
type: '@dougschaefer/utelogy-room'
name: my-client-rooms
globalArguments:
  apiKey: ${{ vault.get(my-client, utelogy-api-key) }}
  authorization: ${{ vault.get(my-client, utelogy-authorization) }}
  baseUrl: https://portal.utelogy.com
```

## Multi-Tenant MSP Usage

Create separate vaults and model instances per client:

```bash
# Client A
swamp vault create client-a
swamp vault put client-a/utelogy-api-key "key-a"
swamp vault put client-a/utelogy-authorization "auth-a"

# Client B
swamp vault create client-b
swamp vault put client-b/utelogy-api-key "key-b"
swamp vault put client-b/utelogy-authorization "auth-b"
```

Each model instance resolves its own vault credentials independently — no cross-tenant data leakage.

## Related

- **[Utelogy MCP Server](https://github.com/American-Sound/utelogy-mcp-server)** — MCP server for Claude Code integration with Utelogy (maintained by American Sound & Electronics)
- **[Utelogy REST API](https://portal.utelogy.com/swagger/docs/v1)**

## License

MIT — see [LICENSE](LICENSE)
