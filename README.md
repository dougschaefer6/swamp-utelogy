# @dougschaefer/utelogy

A [Swamp](https://swamp.club) extension that integrates with the Utelogy AV monitoring platform's REST API to pull room status with CLM health and metrics, asset inventory with driver and feature details, active and historical alerts with acknowledgement, and Global Device Library search for discovering supported device drivers and capabilities. Each API response persists as a versioned Swamp resource with automatic garbage collection, so your AV fleet state accumulates a diffable history over time and participates in CEL expressions and workflow triggers alongside everything else in your repo.

## Models

### `@dougschaefer/utelogy-room`

Rooms monitored by Utelogy, each carrying CLM (Connection Lifecycle Manager) service status, real-time metrics, and embedded alert summaries. Resources persist with infinite lifetime and garbage collection after 10 versions.

| Method | Description | Arguments |
|--------|-------------|-----------|
| `list` | List all rooms with metrics, CLM status, and active alerts | None |
| `get` | Get detailed information about a specific room | `id` (room ID) |
| `getAlerts` | List active alerts for a specific room | `id` (room ID) |

### `@dougschaefer/utelogy-asset`

Monitored assets covering AV devices, compute endpoints, and network infrastructure across all rooms. Same persistence and GC settings as rooms.

| Method | Description | Arguments |
|--------|-------------|-----------|
| `list` | List all monitored assets across all rooms | None |
| `get` | Get detailed information about a specific asset | `id` (asset ID) |

### `@dougschaefer/utelogy-alert`

Alerts with full target info (room, device, manufacturer, serial number), severity levels, and acknowledgment state. The `acknowledge` method is the only write operation in the extension, as Utelogy's REST API does not expose U-Automate script triggering or device control endpoints.

| Method | Description | Arguments |
|--------|-------------|-----------|
| `listActive` | List all currently active (unacknowledged) alerts | None |
| `list` | List alerts with optional date range filter | `occurredFrom` (ISO 8601, optional), `occurredTo` (ISO 8601, optional) |
| `acknowledge` | Acknowledge an active alert | `id` (alert ID) |

### `@dougschaefer/utelogy-gdl`

Global Device Library reference data covering manufacturers, device categories, feature capabilities, and drivers. This model returns data directly rather than persisting resources, since GDL entries are reference material rather than monitored state.

| Method | Description | Arguments |
|--------|-------------|-----------|
| `listManufacturers` | List all manufacturers in the GDL | None |
| `listDeviceKinds` | List all device categories | None |
| `listFeatureKinds` | List feature capabilities (power, volume, input, etc.) | None |
| `listDrivers` | List all device drivers | None |
| `searchDrivers` | Search drivers by keyword | `keywords` (search string) |

## Installation

```bash
swamp extension pull @dougschaefer/utelogy
```

## Setup

The extension authenticates against the Utelogy REST API using an API key and a Base64-encoded authorization header, both of which come from the U-Manage admin portal under your account's API settings.

Store both credentials in a Swamp vault:

```bash
swamp vault create my-vault
swamp vault put my-vault "utelogy-api-key=your-api-key"
swamp vault put my-vault "utelogy-authorization=your-base64-auth"
```

Then create model instances that reference the vault. You need one instance per model type you want to use:

```bash
swamp model create @dougschaefer/utelogy-room my-rooms \
  --global-arg 'apiKey=${{ vault.get(my-vault, utelogy-api-key) }}' \
  --global-arg 'authorization=${{ vault.get(my-vault, utelogy-authorization) }}'

swamp model create @dougschaefer/utelogy-asset my-assets \
  --global-arg 'apiKey=${{ vault.get(my-vault, utelogy-api-key) }}' \
  --global-arg 'authorization=${{ vault.get(my-vault, utelogy-authorization) }}'

swamp model create @dougschaefer/utelogy-alert my-alerts \
  --global-arg 'apiKey=${{ vault.get(my-vault, utelogy-api-key) }}' \
  --global-arg 'authorization=${{ vault.get(my-vault, utelogy-authorization) }}'

swamp model create @dougschaefer/utelogy-gdl my-gdl \
  --global-arg 'apiKey=${{ vault.get(my-vault, utelogy-api-key) }}' \
  --global-arg 'authorization=${{ vault.get(my-vault, utelogy-authorization) }}'
```

The `baseUrl` defaults to `https://portal.utelogy.com` and only needs to be overridden if your Utelogy instance runs on a different host.

## API Compatibility

The extension targets Utelogy's REST API as documented at the [Swagger endpoint](https://portal.utelogy.com/swagger/docs/v1). All operations are read-only except `acknowledge`, which marks an alert as acknowledged.

The authorization header requires the `Basic ` prefix. The client prepends it automatically if you pass just the Base64 value, so either `Basic dXNlcjpwYXNz` or `dXNlcjpwYXNz` will work.

Utelogy supports webhooks for alert events (set/clear) with HMAC SHA-256 signing, configured per account in U-Manage. This extension does not implement webhook ingestion.

## License

MIT — see [LICENSE](LICENSE)
