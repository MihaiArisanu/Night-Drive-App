FROM node:20-alpine AS development

RUN apk add --no-cache bash git openssh

WORKDIR /app

COPY package*.json ./
COPY yarn.lock* ./

RUN npm install

COPY . .

FROM node:20-alpine AS runner

WORKDIR /app

COPY --from=development /app .

USER node
EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD nc -z localhost 8081 || exit 1

CMD ["npm", "start"]