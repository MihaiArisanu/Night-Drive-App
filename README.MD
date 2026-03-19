# 🌙 NightDrive: Social Navigation for Midnight Drivers

**NightDrive** is a community-driven navigation platform designed for car enthusiasts who value the experience of the drive as much as the destination. Unlike standard GPS apps, NightDrive focuses on road quality, social cruising, and real-time hazard reporting with a sleek, OLED-friendly aesthetic.

---

## 🏗️ Monorepo Architecture

This project is organized as a modular monorepo for seamless development and orchestration:

* **/client**: The cross-platform mobile application built with **React Native**.
* **/api**: The high-performance spatial backend powered by **Go** and **PostGIS**.
* **Docker Orchestration**: The entire ecosystem (Database, API, and Metro Bundler) can be launched with a single command.

## 🚀 Quick Start (Docker)

To spin up the entire stack, ensure you have Docker installed and run:

```bash
docker-compose up --build