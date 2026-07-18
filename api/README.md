# NightDrive Backend API

The backend is NightDrive's security and coordination boundary. It is a Go HTTP service responsible for authentication, social relationships, location authorization, navigation orchestration, persistent groups, spontaneous ride matching, push notifications, WebSocket events, avatar access, and database migrations.

The API is not a generic CRUD layer: privacy and group rules are enforced server-side so a modified mobile client cannot grant itself access to another user's location or group.

## Responsibilities

- create accounts, authenticate users, rotate refresh tokens, and enforce one active device per account;
- validate input, return structured errors, and rate-limit sensitive authentication endpoints;
- manage profiles, passwords, feedback, FCM tokens, avatars, and complete account deletion;
- manage friend requests, friendships, removals, notification counts, and nearby friends;
- authorize live location visibility based on friendship, distance, DND, group membership, and freshness;
- plan standard routes and orchestrate Zen Engine sessions;
- persist avoidance streets and drawn polygons using PostGIS;
- manage planned and spontaneous ride groups, ownership, destinations, and shared stops;
- issue short-lived LiveKit participant tokens only to current group members;
- deliver realtime events through authenticated WebSockets and push notifications through Firebase;
- store and validate community reports and votes.

## Internal architecture

```text
cmd/api/main.go
  |-- middleware and HTTP handlers
  |       |-- request validation and authorization
  |       `-- response mapping
  |-- domain-oriented services
  |       |-- routing/
  |       |-- spontaneous/
  |       |-- streets/
  |       |-- zen/
  |       |-- push/
  |       `-- ws/
  `-- db/
          |-- PostgreSQL/PostGIS repositories
          `-- Redis repositories and expiring state
```

### Directory map

| Path | Purpose |
| --- | --- |
| `cmd/api/` | composition root, dependency wiring, routes, server lifecycle |
| `internal/handlers/` | HTTP transport, authentication middleware, validation, error mapping |
| `internal/db/` | SQL/Redis persistence and transactional operations |
| `internal/models/` | request, response, and shared domain data structures |
| `internal/routing/` | Google Directions integration and avoidance-aware route selection |
| `internal/spontaneous/` | spontaneous offer eligibility, locking, routing checks, and notifications |
| `internal/streets/` | Overpass-based street geometry resolution |
| `internal/zen/` | internal client for the Python Zen Engine |
| `internal/push/` | push notification abstraction and Firebase implementation |
| `internal/ws/` | authenticated realtime connections and Redis-aware hub |
| `sql/migrations/` | ordered, reversible PostgreSQL/PostGIS schema migrations |

## Main API areas

All protected routes use `Authorization: Bearer <access-token>`. The API prefix is `/api/v1`.

| Area | Representative routes |
| --- | --- |
| Authentication | `POST /login`, `POST /users`, `POST /auth/refresh`, `POST /auth/session/claim`, `POST /auth/logout`, `POST /auth/ws-ticket` |
| Profile | `GET/DELETE /users/me`, `PATCH /users/profile`, `PATCH /users/password`, `POST /users/avatar`, `PUT /users/fcm` |
| Social | `GET/DELETE /friends`, `POST /friends/request`, `GET /friends/requests`, `POST /friends/requests/{id}/respond`, `GET /notifications/count` |
| Navigation | `POST /routes/plan`, `POST /routes/zen/start`, `POST /routes/zen/sync`, `DELETE /routes/zen/stop`, `PUT /routes/active` |
| Avoidance | `GET/POST /users/dislikes`, `DELETE /users/dislikes/{id}` |
| Groups | invitations, current group, join/leave/close, destination, stops, group details, and voice token routes |
| Spontaneous rides | `POST /spontaneous-rides/{id}/respond`; offer creation is triggered by eligible location updates |
| Reports | `GET/POST /events`, `POST /events/vote` |
| Realtime | `GET /ws` using a one-use, short-lived WebSocket ticket |
| Avatars | `GET /avatars/{filename}` proxied through the API to MinIO |

Consult `cmd/api/main.go` for the exact authoritative route list and HTTP method checks.

## Data and privacy rules

- Live coordinates are stored in Redis with a 60-second TTL.
- A friend location is returned only if it is fresh, within 50 km, and the friend is not in DND mode.
- Current members of the same group may see each other's fresh location even when DND is enabled.
- Group IDs supplied by clients never grant access; membership is verified in PostgreSQL.
- Historical coordinates used by Zen Engine are kept in `location_history` until account deletion in the MVP.
- Deleting an account removes database rows through foreign-key cascades and explicit group cleanup, clears Redis state and sessions, revokes remaining access tokens, deletes the avatar, and removes retained voice files.

## Authentication and security

- bcrypt password hashing and password length validation;
- signed HS256 access/refresh JWTs with explicit token-type checks;
- server-side active-session validation and explicit device takeover;
- 30-second, one-use WebSocket tickets instead of JWTs in WebSocket URLs;
- strict rate limiting on login, registration, refresh, logout, takeover, and password recovery;
- parameterized SQL queries and request validation;
- CORS allowlist and optional trusted-proxy header handling;
- internal-secret authentication between Go API and Zen Engine;
- short-lived LiveKit tokens scoped to one group room;
- graceful HTTP shutdown and bounded server timeouts.

Access tokens currently expire after 72 hours, authentication sessions/refresh state after 30 days, WebSocket tickets after 30 seconds, group voice tokens after 10 minutes, and group invitations after 24 hours.

## Infrastructure dependencies

- PostgreSQL 15 with PostGIS;
- Redis 7;
- MinIO;
- Zen Engine internal HTTP service;
- LiveKit;
- Google Directions API;
- Firebase Admin/FCM;
- public Overpass API instances for street geometry.

## Configuration

The Docker service reads the root `.env` through `docker-compose.yml`. Required or relevant values include:

| Variable | Purpose |
| --- | --- |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_HOST`, `DB_PORT` | PostgreSQL connection |
| `REDIS_URL` | Redis connection |
| `JWT_SECRET` | JWT signing secret; must be long and unique |
| `INTERNAL_SECRET` | Go-to-Zen Engine authentication |
| `ZEN_ENGINE_URL` | internal Zen Engine URL |
| `GOOGLE_MAPS_API_KEY` | server-side Directions access |
| `OVERPASS_URLS` | ordered Overpass fallback endpoints |
| `MINIO_ENDPOINT`, `MINIO_USER`, `MINIO_PASSWORD` | avatar object storage |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_PUBLIC_URL` | group voice token generation |
| `FIREBASE_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS` | push notifications |
| `ALLOWED_ORIGINS`, `TRUST_PROXY_HEADERS` | HTTP edge security |
| `SMTP_USER`, `SMTP_PASS` | password recovery and feedback email |
| `SPONTANEOUS_*` | radius, road-distance, GPS quality, TTL, cooldown, and lock settings |

Never commit `.env`, Firebase Admin credentials, production secrets, or signing keys.

## Run with Docker

From the repository root:

```bash
cp .env.example .env
docker compose up -d db
```

A fresh database requires the `zen_ro` login role before the first migration. Open PostgreSQL:

```bash
docker compose exec db psql -U postgres -d nightdrive
```

Create the role with the same password configured as `ZEN_RO_PASSWORD`:

```sql
CREATE ROLE zen_ro LOGIN PASSWORD 'replace_with_ZEN_RO_PASSWORD';
```

Then start the stack:

```bash
docker compose up -d --build
docker compose logs -f nightdrive-api
```

The migration runner starts automatically with the API. The expected health response is available at `http://localhost/api/v1` through Caddy or `http://localhost:8080/api/v1` directly.

## Run outside Docker

Use Go 1.25 or the version declared in `go.mod`, configure every required environment variable, make PostgreSQL/Redis/MinIO/Zen Engine reachable, then run:

```bash
go mod download
go run ./cmd/api
```

Database migrations are applied automatically on startup from `sql/migrations` unless `MIGRATIONS_PATH` is overridden.

## Verification and testing status

Useful checks:

```bash
go build ./...
go vet ./...
```

The current MVP has been validated mainly through end-to-end manual testing on real devices and Docker logs. A comprehensive Go unit/integration suite, disposable database tests, load tests, and CI pipeline are still roadmap items. The SQL files named `seed_test.sql` and `wipe_test.sql` are manual demo-data utilities, not runtime dependencies or automated tests.

## External dependencies

Direct Go dependencies and their exact versions are declared in `go.mod`; transitive versions and checksums are locked in `go.sum`. The backend also calls Google Maps Platform, Firebase, LiveKit, MinIO, and OpenStreetMap/Overpass. See the repository root README for the complete external-resource declaration.

## Production gaps

- public HTTPS/WSS hosting and a production LiveKit deployment;
- managed secret storage and key rotation;
- database backups, restore drills, metrics, alerts, and distributed tracing;
- complete automated testing and abuse/security testing;
- stronger report-abuse controls and explicit location-history retention policy.
