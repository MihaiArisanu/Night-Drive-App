# 🏎️ NightDrive Backend API

The core engine powering **NightDrive**, a community-driven navigation and traffic hazard reporting application (Waze-style). Built with performance and spatial accuracy in mind, this RESTful API handles real-time geographic data, secure user authentication, and community-based event validation.

## ✨ Features

* **Spatial Awareness (PostGIS):** Uses advanced geographic querying (`ST_DWithin`) to fetch nearby traffic events (police, accidents, hazards) based on the user's current GPS coordinates.
* **Secure Authentication:** User passwords are irreversibly hashed using `bcrypt`, and sessions are managed via short-lived JSON Web Tokens (JWT).
* **Community Validation Engine:** Implements an upvote/downvote system. Traffic events that receive too many downvotes are automatically purged from the database to keep the map clean and accurate.
* **Structured & Scalable:** Follows standard Go project layout with a clear separation of concerns (Handlers, Models, DB operations, Middlewares).

## 🛠️ Tech Stack

* **Language:** Go (Golang)
* **Database:** PostgreSQL
* **Spatial Extension:** PostGIS
* **Infrastructure:** Docker (for isolated database deployment)
* **Security:** JWT (golang-jwt), Bcrypt (x/crypto)

## 📂 Project Structure

```text
├── cmd/
│   └── api/
│       └── main.go           # Application entry point & router setup
├── internal/
│   ├── db/                   # Database connection and queries (users, events)
│   ├── handlers/             # HTTP route handlers and JWT middleware
│   └── models/               # Go structs defining Request/Response payloads
├── go.mod                    # Go module dependencies
└── README.md