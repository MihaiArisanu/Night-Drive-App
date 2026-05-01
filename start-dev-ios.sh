#!/bin/bash

echo "Starting docker containers..."
docker-compose up --build -d

echo "Starting metro & app..."
cd client 
npx react-native start --reset-cache && npm run ios