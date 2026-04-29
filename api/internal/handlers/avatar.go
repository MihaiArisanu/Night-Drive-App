package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
	"github.com/google/uuid"
)

const maxUploadSize = 5 * 1024 * 1024

func UploadAvatarHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}

		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
		if err := r.ParseMultipartForm(maxUploadSize); err != nil {
			RespondWithError(w, http.StatusBadRequest, "api_error", "Fișierul este prea mare (Max 5MB)", nil)
			return
		}

		file, _, err := r.FormFile("avatar")
		if err != nil {
			RespondWithError(w, http.StatusBadRequest, "api_error", "Eroare la preluarea fișierului", nil)
			return
		}
		defer file.Close()

		buff := make([]byte, 512)
		_, err = file.Read(buff)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Eroare la citirea fișierului", nil)
			return
		}

		filetype := http.DetectContentType(buff)
		if filetype != "image/jpeg" && filetype != "image/png" && filetype != "image/webp" {
			RespondWithError(w, http.StatusBadRequest, "api_error", "Sunt permise doar imagini (JPEG, PNG, WEBP)", nil)
			return
		}

		_, err = file.Seek(0, io.SeekStart)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Eroare internă", nil)
			return
		}

		uploadDir := "./uploads/avatars"
		err = os.MkdirAll(uploadDir, os.ModePerm)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Eroare la crearea folderului", nil)
			return
		}

		var ext string
		switch filetype {
		case "image/jpeg":
			ext = ".jpg"
		case "image/png":
			ext = ".png"
		case "image/webp":
			ext = ".webp"
		default:
			ext = ".png"
		}
		newFileName := fmt.Sprintf("%s%s", uuid.New().String(), ext)
		filePath := filepath.Join(uploadDir, newFileName)

		dst, err := os.Create(filePath)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Eroare la salvarea fișierului", nil)
			return
		}
		defer dst.Close()

		if _, err := io.Copy(dst, file); err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Eroare la scrierea pe disc", nil)
			return
		}

		avatarURL := fmt.Sprintf("/uploads/avatars/%s", newFileName)

		if err := db.UpdateAvatar(database, userID, avatarURL); err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Eroare la salvarea în baza de date", nil)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"message":    "Avatar actualizat cu succes",
			"avatar_url": avatarURL,
		})
	}
}
