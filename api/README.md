# 🏎️ NightDrive Backend API

The core engine powering **NightDrive**. A RESTful API built with Go, optimized for handling real-time geographic data and secure community interactions.

## ✨ Features

* **Spatial Awareness (PostGIS):** Advanced geographic querying (`ST_DWithin`) to fetch hazards based on real-time user coordinates.
* **Secure Authentication:** Password hashing via `bcrypt` and session management via JWT.
* **Validation Engine:** Community-based upvote/downvote system to filter out inaccurate traffic reports.
* **Scalable Layout:** Clean separation of Handlers, Models, and DB operations.

## 🛠️ Tech Stack

* **Language:** Go (Golang)
* **Database:** PostgreSQL + PostGIS extension.
* **Security:** JWT (golang-jwt), Bcrypt.
* **Deployment:** Dockerized for consistent environments.

## 📂 Internal Structure
* `/cmd/api`: Application entry point.
* `/internal/db`: Spatial queries and user management.
* `/internal/handlers`: HTTP logic and Auth middlewares.