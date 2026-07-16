package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
	"github.com/MihaiArisanu/nightdrive-backend/internal/streets"
)

func DislikesHandler(database *sql.DB, streetResolver streets.Resolver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
			return
		}

		w.Header().Set("Content-Type", "application/json")

		switch r.Method {
		case http.MethodGet:
			dislikes, err := db.GetDislikedAreas(database, userID)
			if err != nil {
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to fetch disliked areas", err)
				return
			}

			json.NewEncoder(w).Encode(map[string]interface{}{
				"dislikes": dislikes,
			})

		case http.MethodPost:
			var req models.DislikeRequest
			decoder := json.NewDecoder(io.LimitReader(r.Body, 64*1024))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&req); err != nil {
				RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request body", nil)
				return
			}

			req.Reason = strings.TrimSpace(req.Reason)
			req.CoverageType = strings.ToLower(strings.TrimSpace(req.CoverageType))
			if req.CoverageType == "" {
				req.CoverageType = "street"
			}
			if req.Reason == "" || len(req.Reason) > 255 {
				RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid avoidance zone name", nil)
				return
			}
			if req.CoverageType != "street" && req.CoverageType != "area" && req.CoverageType != "polygon" {
				RespondWithError(w, http.StatusBadRequest, "invalid_coverage_type", "Coverage type must be street, area or polygon", nil)
				return
			}
			if req.CoverageType == "polygon" {
				if len(req.Polygon) < 3 || len(req.Polygon) > 80 {
					RespondWithError(w, http.StatusBadRequest, "invalid_polygon", "Draw a zone with between 3 and 80 points", nil)
					return
				}
				for _, point := range req.Polygon {
					if !validCoordinates(point) {
						RespondWithError(w, http.StatusBadRequest, "invalid_polygon", "The drawn zone contains invalid coordinates", nil)
						return
					}
				}
			} else if !validCoordinates(req.Coordinates) {
				RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid coordinates", nil)
				return
			}

			var saveError error
			switch req.CoverageType {
			case "area":
				saveError = db.SaveDislikedArea(database, userID, req)
			case "polygon":
				saveError = db.SaveDrawnDislikedArea(database, userID, req)
			default:
				resolutionContext, cancel := context.WithTimeout(r.Context(), 22*time.Second)
				defer cancel()
				geometry, err := streetResolver.Resolve(resolutionContext, streets.Selection{
					Coordinates: req.Coordinates,
					Name:        req.Reason,
				})
				if err != nil {
					switch {
					case errors.Is(err, streets.ErrStreetNotFound):
						RespondWithError(w, http.StatusUnprocessableEntity, "street_not_found", "We could not identify this street reliably. Try selecting it again.", err)
					case errors.Is(err, streets.ErrResolutionUnavailable), errors.Is(err, context.DeadlineExceeded):
						RespondWithError(w, http.StatusServiceUnavailable, "street_resolution_unavailable", "Street data is temporarily unavailable. Please try again.", err)
					default:
						RespondWithError(w, http.StatusBadGateway, "street_resolution_failed", "Could not load the selected street", err)
					}
					return
				}
				saveError = db.SaveDislikedStreet(database, userID, req, geometry)
			}

			if saveError != nil {
				switch {
				case errors.Is(saveError, db.ErrDislikedAreaAlreadyExists):
					RespondWithError(w, http.StatusConflict, "disliked_area_exists", "This street or area is already blocked", saveError)
				case errors.Is(saveError, db.ErrDislikedAreaLimitReached):
					RespondWithError(w, http.StatusUnprocessableEntity, "disliked_area_limit", "You can block at most 50 areas", saveError)
				case errors.Is(saveError, db.ErrInvalidDislikedPolygon):
					RespondWithError(w, http.StatusUnprocessableEntity, "invalid_polygon", "The zone must be a simple shape between 50 m² and 5 km²", saveError)
				default:
					RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to save disliked area", saveError)
				}
				return
			}

			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]string{"status": "success"})

		default:
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
		}
	}
}

func DislikeByIDHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
			return
		}

		dislikeID := r.PathValue("id")
		if dislikeID == "" {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Missing dislike ID", nil)
			return
		}

		switch r.Method {
		case http.MethodDelete:
			deleted, err := db.DeleteDislikedArea(database, userID, dislikeID)
			if err != nil {
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to delete disliked area", err)
				return
			}
			if !deleted {
				RespondWithError(w, http.StatusNotFound, "not_found", "Disliked street not found", nil)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]string{"status": "success"})
		case http.MethodPatch:
			var req models.DislikeRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request body", nil)
				return
			}
			req.Reason = strings.TrimSpace(req.Reason)
			if req.Reason == "" || len(req.Reason) > 255 {
				RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid street name", nil)
				return
			}

			updated, err := db.UpdateDislikedAreaReason(database, userID, dislikeID, req.Reason)
			if err != nil {
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to update disliked area", err)
				return
			}
			if !updated {
				RespondWithError(w, http.StatusNotFound, "not_found", "Disliked street not found", nil)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]string{"status": "success"})
		default:
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
		}
	}
}
