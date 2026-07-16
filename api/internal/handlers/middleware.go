package handlers

import (
	"bufio"
	"context"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
)

type contextKey string

const UserIDKey contextKey = "userID"
const SessionIDKey contextKey = "sessionID"

func RequireAuth(rdb *redis.Client, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized - Missing Token", nil)
			return
		}

		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized - Invalid Token Format", nil)
			return
		}
		tokenString := parts[1]

		jwtKey := GetJWTKey()

		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			return jwtKey, nil
		}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))

		if err != nil || !token.Valid {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized - Invalid or Expired Token", nil)
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized - Invalid Token Claims", nil)
			return
		}

		if tokenType, _ := claims["type"].(string); tokenType == "refresh" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized - Invalid Token Type", nil)
			return
		}
		userID, ok := claims["user_id"].(string)
		if !ok || userID == "" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized - Invalid Token Claims", nil)
			return
		}
		revoked, err := db.IsUserAccessRevoked(r.Context(), rdb, userID)
		if err != nil {
			RespondWithError(w, http.StatusServiceUnavailable, "auth_unavailable", "Authentication service unavailable", err)
			return
		}
		if revoked {
			RespondWithError(w, http.StatusUnauthorized, "account_deleted", "Account no longer exists", nil)
			return
		}

		sessionID, _ := claims["sid"].(string)
		var sessionValid bool
		if sessionID == "" {
			sessionID = db.LegacySessionID(tokenString)
			sessionValid, err = db.AdoptLegacyAuthSession(r.Context(), rdb, userID, sessionID)
		} else {
			sessionValid, err = db.ValidateAuthSession(r.Context(), rdb, userID, sessionID)
		}
		if err != nil {
			RespondWithError(w, http.StatusServiceUnavailable, "auth_unavailable", "Authentication service unavailable", err)
			return
		}
		if !sessionValid {
			RespondWithError(w, http.StatusUnauthorized, "session_replaced", "This account is active on another device", nil)
			return
		}

		ctx := context.WithValue(r.Context(), UserIDKey, userID)
		ctx = context.WithValue(ctx, SessionIDKey, sessionID)

		next.ServeHTTP(w, r.WithContext(ctx))
	}
}

func LoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		lrw := &loggingResponseWriter{ResponseWriter: w, statusCode: http.StatusOK}

		next.ServeHTTP(lrw, r)

		duration := time.Since(start)
		log.Printf("[%s] %s %s - %d %s - %v",
			requestClientIP(r),
			r.Method,
			r.URL.EscapedPath(),
			lrw.statusCode,
			http.StatusText(lrw.statusCode),
			duration,
		)
	})
}

func requestClientIP(r *http.Request) string {
	if strings.EqualFold(os.Getenv("TRUST_PROXY_HEADERS"), "true") {
		forwardedFor := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
		if len(forwardedFor) > 0 {
			forwardedIP := strings.TrimSpace(forwardedFor[0])
			if net.ParseIP(forwardedIP) != nil {
				return forwardedIP
			}
		}

		realIP := strings.TrimSpace(r.Header.Get("X-Real-IP"))
		if net.ParseIP(realIP) != nil {
			return realIP
		}
	}

	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}

	return r.RemoteAddr
}

type loggingResponseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (lrw *loggingResponseWriter) WriteHeader(code int) {
	lrw.statusCode = code
	lrw.ResponseWriter.WriteHeader(code)
}

func (lrw *loggingResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := lrw.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	return h.Hijack()
}

func CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		allowedOrigins := os.Getenv("ALLOWED_ORIGINS")

		allowed := false
		if allowedOrigins != "" {
			for _, o := range strings.Split(allowedOrigins, ",") {
				if strings.TrimSpace(o) == origin {
					allowed = true
					break
				}
			}
		}

		if allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		} else if origin != "" && allowedOrigins == "" {
		}

		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Content-Length, Accept-Encoding, Authorization, X-CSRF-Token")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func RateLimit(rdb *redis.Client, limit int, window time.Duration) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			ip := requestClientIP(r)
			key := "rate_limit:" + r.URL.Path + ":" + ip
			ctx := context.Background()

			count, err := rdb.Incr(ctx, key).Result()
			if err != nil {
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Internal server error", err)
				return
			}

			if count == 1 {
				rdb.Expire(ctx, key, window)
			}

			if count > int64(limit) {
				RespondWithError(w, http.StatusTooManyRequests, "rate_limit_exceeded", "Too Many Requests", nil)
				return
			}

			next.ServeHTTP(w, r)
		}
	}
}
