# Night Drive 🚘

**Night Drive** is a **native navigation and social platform** for car enthusiasts, especially “midnight drivers.” Unlike apps like Waze or Google Maps, Night Drive prioritizes **driving enjoyment and quality** over just the fastest routes.

---

## 🚀 Concept Overview

Night Drive helps users:

- 🚗 **Find long, straight, low-traffic roads** for cruising
- 👥 **Social cruising:** join friends, share routes, and voice chat
- 🧠 **ML-guided “free cruising” mode** for personalized routes
- 📱 **Full Apple CarPlay & Android Auto integration**
- 🌙 **OLED-friendly night mode UI** for smooth nighttime driving

---

## 🧱 Technical Stack

### Frontend (Native)
- **iOS:** Swift + SwiftUI + Google Maps SDK
- **Android:** Kotlin + Jetpack Compose + Google Maps SDK

### Backend
- **Go:** WebSockets, session management, broadcasting
- **Redis:** Real-time ride room states & geofencing
- **PostgreSQL + PostGIS:** Geospatial queries & route storage

### ML Microservice
- **Python (FastAPI):** Learns preferred routes & scores roads for “Enjoy” mode

### Mapping / Routing
- **Google Maps SDK (native):** Custom night mode with JSON styling
- **EV stations overlay:** via Google Places API
- **Routing:** via Google Directions API