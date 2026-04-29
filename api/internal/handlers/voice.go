package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"github.com/MihaiArisanu/nightdrive-backend/internal/ws"
	"github.com/google/uuid"
)

func UploadVoiceHandler(hub *ws.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, 2<<20)

		err := r.ParseMultipartForm(2 << 20)
		if err != nil {
			RespondWithError(w, http.StatusBadRequest, "api_error", "File too large", nil)
			return
		}

		groupId := r.FormValue("groupId")
		senderName := r.FormValue("senderName")

		senderId, ok := r.Context().Value(UserIDKey).(string)
		if !ok || groupId == "" || senderName == "" {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Missing required fields", nil)
			return
		}

		file, handler, err := r.FormFile("audio")
		if err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid audio file", nil)
			return
		}
		defer file.Close()

		buff := make([]byte, 512)
		_, err = file.Read(buff)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to read file", nil)
			return
		}

		filetype := http.DetectContentType(buff)
		validAudioTypes := map[string]bool{
			"audio/mpeg": true,
			"audio/ogg":  true,
			"audio/mp4":  true,
			"audio/webm": true,
			"audio/aac":  true,
			"audio/wave": true,
			"audio/wav":  true,
		}
		if !validAudioTypes[filetype] {
			RespondWithError(w, http.StatusUnsupportedMediaType, "bad_request", "Invalid file format", nil)
			return
		}

		_, err = file.Seek(0, io.SeekStart)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to process file", nil)
			return
		}

		uploadDir := "./uploads/voice"
		os.MkdirAll(uploadDir, os.ModePerm)

		ext := filepath.Ext(handler.Filename)
		if ext == "" {
			ext = ".m4a"
		}
		filename := fmt.Sprintf("%s%s", uuid.New().String(), ext)
		filePath := filepath.Join(uploadDir, filename)

		dst, err := os.Create(filePath)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to save audio file", nil)
			return
		}
		defer dst.Close()

		io.Copy(dst, file)

		baseURL := os.Getenv("BASE_URL")
		if baseURL == "" {
			baseURL = fmt.Sprintf("http://%s", r.Host)
		}
		audioUrl := fmt.Sprintf("%s/uploads/voice/%s", baseURL, filename)

		wsPayload := map[string]interface{}{
			"type": "VOICE_MESSAGE",
			"payload": map[string]string{
				"audioUrl":   audioUrl,
				"senderName": senderName,
			},
			"targetGroupId":   groupId,
			"excludeSenderId": senderId,
		}

		wsBytes, err := json.Marshal(wsPayload)
		if err == nil {
			hub.Publish(wsBytes)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{
			"status":   "success",
			"audioUrl": audioUrl,
		})
	}
}
