# NightDrive

NightDrive is a social navigation application for drivers who care about the route, not only the destination. It combines conventional navigation with preference-aware routing, live group rides, short voice transmissions, community hazard reports, and spontaneous encounters between nearby friends.

The current repository contains the complete **MVP prepared for InfoEducatie - Software Utilitar**. It is functional on real Android devices and is intended for demonstrations and controlled testing. Public production hosting, store signing, and a complete automated test suite remain post-MVP work.

## Problem and target audience

Standard navigation products optimize mainly for travel time and distance. They do not give drivers a simple way to avoid personally unpleasant streets, organize a shared ride without repeatedly checking messages, or safely discover that a friend is driving nearby.

NightDrive is designed for:

- car enthusiasts and night-drive communities;
- friends travelling together from different starting points;
- drivers who want to avoid specific streets, intersections, or manually drawn areas;
- users who want lightweight, privacy-aware location sharing rather than permanent public tracking.

### Market positioning

| Existing approach | What it does well | Gap addressed by NightDrive |
| --- | --- | --- |
| Google Maps | mature destination routing, search, and traffic information | does not focus on shared social drives or personal hand-drawn avoidance preferences |
| Waze | community reports and fast traffic-aware routing | primarily optimizes arrival rather than a continuous recreational drive with friends |
| generic live-location apps | simple location sharing | do not combine navigation state, group stops, DND rules, voice, and route compatibility |
| chat-based car groups | flexible coordination | require unsafe manual interaction and do not synchronize routes or current stops |

NightDrive does not attempt to replace the mature map data and search infrastructure of these products. It builds a distinct social-driving and preference layer and integrates external mapping services where they are the technically responsible choice.

## What makes NightDrive different

- **Zen Engine:** generates a continuous drive on connected roads when the user does not choose a destination. With little or no history it selects a forward, connected corridor from OpenStreetMap road data and prefers higher-capacity roads. After enough history is available, DBSCAN clusters are used to derive personally relevant waypoints.
- **Personal avoidance zones:** a user can dislike a street or draw a polygon around an intersection or area. Normal routing and Zen routing both take these preferences into account.
- **Persistent planned group rides:** friends can create a group, share a destination and intermediate stops, view members on the map, transfer ownership when the owner leaves, and remain in the group after closing the application.
- **Spontaneous group rides:** two friends who are not in DND mode may receive a ten-second invitation when they are within the configured straight-line and road-distance thresholds. An offer is created only when their active destinations are compatible.
- **Driver-oriented interaction:** turn-by-turn instructions, automatic driving focus mode, dark OLED-oriented UI, and one-tap voice transmissions of at most ten seconds reduce interaction while driving.

## Implemented MVP functionality

### Navigation

- destination search and standard route planning through Google Maps Platform;
- turn-by-turn maneuver and distance display;
- saved places and route state synchronization;
- Zen Engine cold-start road-corridor generation and history-based waypoint generation;
- street and freehand polygon avoidance in both normal and Zen routes;
- driving focus mode that hides secondary controls after ten seconds without interaction;
- heading, speed, recentering, and nearby fuel-station search.

### Social and groups

- accounts, profiles, unique tags, avatars, friend requests, friend removal, and notification badge;
- Firebase push notifications for friend requests and group invitations;
- live friend locations with DND and distance controls;
- planned group invitations, pending state, membership, ownership, destination, shared stops, leave, and close flows;
- automatic ownership transfer to the oldest remaining member;
- spontaneous two-person ride offers with explicit accept/decline and cooldown;
- LiveKit group voice with a maximum ten-second transmission and no application-level recording storage.

### Community and safety

- nearby police, radar, accident, hazard, pothole, and roadwork reports;
- report expiry based on event type;
- community confirmation and rejection; an event is removed when downvotes exceed upvotes by three;
- request validation, authentication rate limiting, structured API errors, and Crashlytics integration.

### Account and privacy controls

- passwords hashed with bcrypt;
- access and refresh tokens, short-lived WebSocket tickets, and server-side session validation;
- one active device per account, with an explicit session takeover flow;
- account deletion including relational data, live Redis state, active sessions, avatar, and retained voice files;
- live locations stored in Redis expire after **60 seconds**;
- outside a group, only friends within **50 km** can receive a fresh location and only while DND is disabled;
- current group members can receive each other's fresh location even when DND is enabled;
- historical coordinates used by Zen Engine are stored in PostgreSQL until account deletion in the MVP.

## Architecture

```text
React Native mobile client
  |-- REST (local HTTP; production HTTPS) -> Go API
  |-- authenticated WebSocket --------> Go realtime hub + Redis
  |-- WebRTC audio --------------------> LiveKit
  |-- map/search UI -------------------> Google Maps Platform
                                           |
                                           |-- PostgreSQL + PostGIS
                                           |-- Redis
                                           |-- MinIO
                                           |-- Firebase Cloud Messaging
                                           `-- FastAPI Zen Engine
                                                   |-- OpenStreetMap / Overpass
                                                   `-- DBSCAN history analysis
```

The Go API is the trust boundary. The mobile client never receives database, MinIO, Firebase Admin, or LiveKit API secrets. Zen Engine is an internal service authenticated with a shared internal secret and receives read-only database access.

## Repository structure

| Path | Responsibility |
| --- | --- |
| `client/` | React Native TypeScript mobile application and native Android/iOS integration |
| `api/` | Go REST API, authentication, social logic, routing orchestration, WebSockets, and migrations |
| `zen-engine/` | Python FastAPI service for road-corridor and history-based Zen waypoint generation |
| `docker-compose.yml` | Local MVP infrastructure: API, database, Redis, Zen Engine, MinIO, LiveKit, and Caddy |
| `Caddyfile` | Reverse proxy entry point for the API |

More implementation details are available in [the API README](api/README.md) and [the client README](client/README.md).

## Local installation

### Prerequisites

- Docker Desktop with Docker Compose;
- Node.js **22.11 or newer** and npm;
- Android Studio, Android SDK, an Android device/emulator, and a compatible JDK;
- a Google Maps Platform key with the Android Maps SDK, Places API, and Directions API enabled;
- a Firebase project for Cloud Messaging and Crashlytics.

Go 1.25 and Python 3.11 are only required when running the backend services outside Docker.

### 1. Configure the infrastructure

```bash
cp .env.example .env
```

Replace every placeholder in `.env`. In particular, use strong values for `DB_PASSWORD`, `ZEN_RO_PASSWORD`, `INTERNAL_SECRET`, `JWT_SECRET`, `MINIO_PASSWORD`, and `LIVEKIT_API_SECRET`. Set `LIVEKIT_NODE_IP` to the LAN address of the Docker host and set `LIVEKIT_PUBLIC_URL` to the corresponding WebSocket URL.

On a completely new database volume, create the read-only Zen Engine role before the API applies its first migration:

```bash
docker compose up -d db
docker compose exec db psql -U postgres -d nightdrive
```

Then run the following SQL, using the same password as `ZEN_RO_PASSWORD`:

```sql
CREATE ROLE zen_ro LOGIN PASSWORD 'replace_with_ZEN_RO_PASSWORD';
```

Start the complete stack:

```bash
docker compose up -d --build
docker compose ps
```

The API health response is available at `http://localhost/api/v1`. MinIO's local administration console is exposed on port `9001`, and LiveKit is exposed on port `7880` plus its TCP/UDP media ports.

### 2. Configure the mobile client

```bash
cd client
cp .env.example .env
npm install
```

Set:

```dotenv
API_BASE_URL=http://YOUR_COMPUTER_LAN_IP/api/v1
GOOGLE_API_GENERAL_KEY=your_google_maps_key
ALLOW_CLEARTEXT_TRAFFIC=true
```

For a physical device, the API and LiveKit addresses must be reachable from that device. The computer and phone normally need to be on the same network for the current local MVP setup. Firebase Android configuration is read from `client/android/app/google-services.json`.

Build and install the Android release variant used for MVP testing:

```bash
npx react-native run-android --mode="release"
```

The current release variant uses the debug signing key and allows configurable cleartext traffic. A store build must use a private release keystore, `ALLOW_CLEARTEXT_TRAFFIC=false`, and public HTTPS/WSS endpoints.

## Verification

The MVP has been manually exercised on multiple Android devices for authentication, navigation, friend flows, group persistence, shared stops, spontaneous offers, push notifications, account deletion, and LiveKit audio.

Available client checks:

```bash
cd client
npm run lint
npx tsc --noEmit
npm test
```

There is currently no comprehensive automated unit, integration, load, battery, or security test suite. This is a known MVP limitation and is not represented as completed work.

## Known limitations and roadmap

- move API and LiveKit from the local network to stable public HTTPS/WSS infrastructure;
- add production Android/iOS signing, secret management, and store release configuration;
- introduce automated backend, client, integration, routing, and load tests in CI;
- add retention controls for location history and export/privacy tooling;
- strengthen false-report prevention with per-user vote constraints, reputation, rate limits, and anomaly detection;
- add Google Sign-In and improve offline/degraded-network behavior;
- measure battery, memory, route latency, and realtime scalability on a wider device set;
- expand spontaneous rides beyond two participants only after validating the safety model.

## External resources and third-party services

NightDrive's application-specific source is implemented in this repository. The project relies on the following declared external technologies and services:

- **[Google Maps Platform](https://developers.google.com/maps):** base map, place search, geocoding-related UI, and road directions;
- **[OpenStreetMap](https://www.openstreetmap.org/copyright) data and [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API):** road topology used by Zen Engine and street geometry resolution;
- **[Firebase Cloud Messaging and Crashlytics](https://firebase.google.com/docs):** device notifications and crash reporting;
- **[LiveKit](https://docs.livekit.io/):** WebRTC group voice transport;
- **[PostgreSQL](https://www.postgresql.org/) and [PostGIS](https://postgis.net/):** relational and geospatial persistence;
- **[Redis](https://redis.io/):** expiring live state, sessions, coordination locks, rate limits, and realtime fan-out support;
- **[MinIO](https://min.io/):** S3-compatible avatar object storage;
- **[Caddy](https://caddyserver.com/) and [Docker](https://www.docker.com/):** reverse proxy and reproducible service orchestration;
- **[React Native](https://reactnative.dev/), React Navigation, Zustand, react-native-maps, react-native-geolocation-service, React Native Firebase**, and the other npm packages declared in `client/package.json` and `client/package-lock.json`;
- **Go libraries** declared in `api/go.mod` and `api/go.sum`, including pgx, golang-jwt, validator, Gorilla WebSocket, go-redis, MinIO, Firebase Admin, and LiveKit protocol;
- **Python libraries** declared in `zen-engine/requirements.txt`, including FastAPI, asyncpg, scikit-learn, NumPy, HTTPX, Redis, and Uvicorn.

All third-party components remain subject to their own licenses and terms. API keys, passwords, service-account files, signing keys, and `.env` files must not be committed.

## Project documentation

- [`NightDrive_MVP_Documentatie_5_pagini.pdf`](output/pdf/NightDrive_MVP_Documentatie_5_pagini.pdf) - five-page executive documentation, including the product roadmap;
- [`NightDrive_Manual_Explicativ_Complet.pdf`](output/pdf/NightDrive_Manual_Explicativ_Complet.pdf) - personal technical manual explaining the architecture, terminology, end-to-end flows, and every relevant project file.

## Author

NightDrive is designed and developed by **Mihai Arisanu**.
