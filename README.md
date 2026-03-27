# Swamp Utelogy Extension

Utelogy is the AV monitoring platform that sits between your device fleet and your operations team, tracking room health, asset status, and alert state across every endpoint it manages. This [Swamp](https://swamp.club) extension pulls that data out of the Utelogy API and into Swamp's versioned resource model, so your AV monitoring state lives alongside the rest of your infrastructure state and participates in the same CEL expressions, workflow triggers, and cross-platform automations as everything else in your repo.

## What It Does

Without this extension, Utelogy API responses are ephemeral snapshots that disappear the moment you close the terminal. The extension persists each room, asset, and alert as a tracked Swamp resource with infinite lifetime and automatic garbage collection, which means you get a versioned history of your AV fleet state over time, the ability to diff what changed between any two points, and CEL expressions that can reference Utelogy data in workflows that also touch Cisco endpoints, Azure infrastructure, or anything else Swamp manages.

## Models

The extension provides four models covering the core objects in Utelogy's monitoring hierarchy, from rooms (the physical spaces) down through the assets inside them and the alerts they generate, plus the Global Device Library reference data that underpins driver and feature capability lookups.

### `@dougschaefer/utelogy-room`

Rooms monitored by Utelogy with CLM (Connection Lifecycle Manager) status, metrics, and alert summaries. Each room persists as a tracked resource with infinite lifetime and garbage collection after 10 versions.

| Method | What It Does |
|--------|-------------|
| `list` | List all rooms, persists each as a tracked resource |
| `get` | Get a specific room by ID |
| `getAlerts` | List active alerts for a specific room |

### `@dougschaefer/utelogy-asset`

Monitored assets (AV devices, compute endpoints, network infrastructure) across all rooms. Resources persist with the same lifetime and GC settings as rooms.

| Method | What It Does |
|--------|-------------|
| `list` | List all assets, persists each as a tracked resource |
| `get` | Get a specific asset by ID |

### `@dougschaefer/utelogy-alert`

Alerts with full target info, severity levels, and acknowledgment state. The `acknowledge` method is the only write operation in the extension, everything else is read-only by design since Utelogy's API does not expose U-Automate script triggering or device control.

| Method | What It Does |
|--------|-------------|
| `listActive` | List all currently active (unacknowledged) alerts |
| `list` | List alerts with optional date range filter |
| `acknowledge` | Acknowledge an active alert by ID |

### `@dougschaefer/utelogy-gdl`

Global Device Library reference data covering manufacturers, device categories, feature capabilities, and drivers. This model does not persist resources since GDL data is reference material rather than monitored state.

| Method | What It Does |
|--------|-------------|
| `listManufacturers` | List all manufacturers |
| `listDeviceKinds` | List device categories |
| `listFeatureKinds` | List feature capabilities (power, volume, input, etc.) |
| `listDrivers` | List all drivers |
| `searchDrivers` | Search drivers by keyword |

## Prerequisites

You need the [Swamp CLI](https://swamp.club) installed, a Utelogy portal account with API access, and your Utelogy API key and Base64 authorization header stored in a Swamp vault.

```bash
curl -fsSL swamp.club/install.sh | sh
```

## Installation

```bash
swamp extension pull @dougschaefer/utelogy
```

## Credential Setup

Store your Utelogy credentials in a Swamp vault so they resolve at runtime rather than living in your model definitions. For MSP environments with multiple client deployments, create one vault per client to maintain credential isolation.

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

Each client gets its own vault and its own model instances, so credentials and state are isolated by design rather than by convention. One client's token can never resolve in another client's model instance, and one client's room data never appears in another client's resource graph.

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

## Related

- **[Utelogy MCP Server](https://github.com/American-Sound/utelogy-mcp-server)** provides Claude Code integration with the same Utelogy REST API, designed for interactive queries and conversational device management rather than the persistent state tracking this extension handles.
- **[Utelogy REST API](https://portal.utelogy.com/swagger/docs/v1)**

## License

MIT — see [LICENSE](LICENSE)
