# 🌙 NightDrive: Social Navigation for Midnight Drivers

**NightDrive** is a community-driven navigation platform designed for car enthusiasts who value the experience of the drive as much as the destination. Unlike standard GPS apps, NightDrive focuses on road quality, social cruising, and real-time hazard reporting with a sleek, OLED-friendly aesthetic.

---

## ✨ Feature Overview
* **Zen-Engine Routing**: Smart routing algorithm that maps and automatically avoids disliked, stressful, or unsafe streets.
* **Real-Time Group Rides**: View friends on the map in real-time, eliminating the need to text while driving.
* **Voice-to-Text AI**: Activates automatically at speeds >10 km/h for safe, hands-free communication.
* **OLED-Friendly Aesthetic**: Dark mode by default, designed to reduce eye strain during midnight cruising.

## 🏗️ Architecture

The project is organized as a modular monorepo. Here is the high-level data flow:

**`Client (React Native)`** ➔ **`Go API`** ➔ **`[PostgreSQL/PostGIS + Redis + Zen Engine]`**

* **/client**: Cross-platform mobile application built with **React Native**.
* **/api**: High-performance spatial backend powered by **Go**.
* **/zen-engine**: Custom Machine Learning routing engine built with **Python**, responsible for the safety-first "Zen" route calculations.
* **Database & Cache**: **PostgreSQL** with **PostGIS** for spatial queries, and **Redis** for real-time tracking, sessions, and WebSocket management.

## ⚙️ Setup Instructions

### Prerequisites
Ensure you have the following installed on your local machine:
* [Docker](https://docs.docker.com/get-docker/) & Docker Compose
* [Node.js](https://nodejs.org/) (v18+)
* [Go](https://go.dev/) (1.20+)
* React Native development environment (Xcode / Android Studio)

### How to run:
* `docker-compose up --build -d`

* `cd client`
* `npm install`
* `npx react-native start --reset-cache`

* `npm run ios`  or `npm run android`
