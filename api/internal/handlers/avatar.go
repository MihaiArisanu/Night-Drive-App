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

const maxUploadSize = 5 * 1024 * 1024 // 5 MB

func UploadAvatarHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
		if err := r.ParseMultipartForm(maxUploadSize); err != nil {
			http.Error(w, "Fișierul este prea mare (Max 5MB)", http.StatusBadRequest)
			return
		}

		file, fileHeader, err := r.FormFile("avatar")
		if err != nil {
			http.Error(w, "Eroare la preluarea fișierului", http.StatusBadRequest)
			return
		}
		defer file.Close()

		buff := make([]byte, 512)
		_, err = file.Read(buff)
		if err != nil {
			http.Error(w, "Eroare la citirea fișierului", http.StatusInternalServerError)
			return
		}

		filetype := http.DetectContentType(buff)
		if filetype != "image/jpeg" && filetype != "image/png" && filetype != "image/webp" {
			http.Error(w, "Sunt permise doar imagini (JPEG, PNG, WEBP)", http.StatusBadRequest)
			return
		}

		_, err = file.Seek(0, io.SeekStart)
		if err != nil {
			http.Error(w, "Eroare internă", http.StatusInternalServerError)
			return
		}

		uploadDir := "./uploads/avatars"
		err = os.MkdirAll(uploadDir, os.ModePerm)
		if err != nil {
			http.Error(w, "Eroare la crearea folderului", http.StatusInternalServerError)
			return
		}

		ext := filepath.Ext(fileHeader.Filename)
		if ext == "" {
			ext = ".png" // Fallback
		}
		newFileName := fmt.Sprintf("%s%s", uuid.New().String(), ext)
		filePath := filepath.Join(uploadDir, newFileName)

		dst, err := os.Create(filePath)
		if err != nil {
			http.Error(w, "Eroare la salvarea fișierului", http.StatusInternalServerError)
			return
		}
		defer dst.Close()

		if _, err := io.Copy(dst, file); err != nil {
			http.Error(w, "Eroare la scrierea pe disc", http.StatusInternalServerError)
			return
		}

		avatarURL := fmt.Sprintf("/uploads/avatars/%s", newFileName)

		if err := db.UpdateAvatar(database, userID, avatarURL); err != nil {
			http.Error(w, "Eroare la salvarea în baza de date", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"message":    "Avatar actualizat cu succes",
			"avatar_url": avatarURL,
		})
	}
}
