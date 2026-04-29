package handlers

import (
	"encoding/json"
	"log"
	"net/http"
)

type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

func RespondWithError(w http.ResponseWriter, statusCode int, errorCode string, message string, err error) {
	if err != nil {
		log.Printf("[ERROR] %s: %v\n", message, err)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(ErrorResponse{
		Error:   errorCode,
		Message: message,
	})
}
