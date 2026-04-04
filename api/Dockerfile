FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.* ./
RUN go mod download
COPY . .
RUN go build -o main ./cmd/api/main.go

FROM alpine:latest

RUN addgroup -S nightdrive && adduser -S nightdriver -G nightdrive

WORKDIR /app

COPY --from=builder /app/main .

RUN mkdir -p /app/uploads/voice && \
    chown -R nightdriver:nightdrive /app && \
    chmod 550 /app/main && \
    chmod -R 750 /app/uploads

USER nightdriver

EXPOSE 8080
CMD ["./main"]