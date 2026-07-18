package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
	"github.com/MihaiArisanu/nightdrive-backend/internal/spontaneous"
	"github.com/google/uuid"
)

func RespondSpontaneousRideHandler(
	database *sql.DB,
	service *spontaneous.Service,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}
		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
			return
		}
		offerID := r.PathValue("id")
		if _, err := uuid.Parse(offerID); err != nil {
			RespondWithError(w, http.StatusBadRequest, "invalid_offer_id", "Invalid spontaneous ride offer ID", nil)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, 4*1024)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var request struct {
			Decision string `json:"decision"`
		}
		if err := decoder.Decode(&request); err != nil || (request.Decision != "accept" && request.Decision != "decline") {
			RespondWithError(w, http.StatusBadRequest, "invalid_decision", "Decision must be accept or decline", err)
			return
		}
		decision := "accepted"
		if request.Decision == "decline" {
			decision = "declined"
		}
		result, err := service.Respond(r.Context(), userID, offerID, decision)
		if err != nil {
			switch {
			case errors.Is(err, db.ErrSpontaneousOfferNotFound):
				RespondWithError(w, http.StatusNotFound, "spontaneous_offer_not_found", "Spontaneous ride offer not found", nil)
			case errors.Is(err, db.ErrSpontaneousOfferResolved):
				RespondWithError(w, http.StatusConflict, "spontaneous_offer_resolved", "Spontaneous ride offer is no longer active", nil)
			default:
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to respond to spontaneous ride offer", err)
			}
			return
		}

		response := map[string]interface{}{
			"offerId": result.OfferID,
			"status":  result.Status,
			"groupId": result.GroupID,
		}
		if result.Status == "matched" && result.GroupID != "" {
			details, detailsErr := loadGroupDetails(r.Context(), database, result.GroupID, userID)
			if detailsErr == nil {
				response["group"] = details
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(response)
	}
}
