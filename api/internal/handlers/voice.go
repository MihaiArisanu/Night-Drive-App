package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/MihaiArisanu/nightdrive-backend/internal/ws"
)

func UploadVoiceHandler(hub *ws.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, 5<<20)

		err := r.ParseMultipartForm(5 << 20)
		if err != nil {
			http.Error(w, "File too large", http.StatusBadRequest)
			return
		}

		groupId := r.FormValue("groupId")
		senderName := r.FormValue("senderName")

		senderId, ok := r.Context().Value(UserIDKey).(string)
		if !ok || groupId == "" || senderName == "" {
			http.Error(w, "Missing required fields", http.StatusBadRequest)
			return
		}

		file, handler, err := r.FormFile("audio")
		if err != nil {
			http.Error(w, "Invalid audio file", http.StatusBadRequest)
			return
		}
		defer file.Close()

		buff := make([]byte, 512)
		_, err = file.Read(buff)
		if err != nil {
			http.Error(w, "Failed to read file", http.StatusInternalServerError)
			return
		}

		filetype := http.DetectContentType(buff)
		if !strings.HasPrefix(filetype, "audio/") && filetype != "application/octet-stream" && filetype != "video/mp4" {
			http.Error(w, "Invalid file format", http.StatusUnsupportedMediaType)
			return
		}

		_, err = file.Seek(0, io.SeekStart)
		if err != nil {
			http.Error(w, "Failed to process file", http.StatusInternalServerError)
			return
		}

		uploadDir := "./uploads/voice"
		os.MkdirAll(uploadDir, os.ModePerm)

		filename := fmt.Sprintf("%d_%s", time.Now().UnixNano(), handler.Filename)
		filePath := filepath.Join(uploadDir, filename)

		dst, err := os.Create(filePath)
		if err != nil {
			http.Error(w, "Failed to save audio file", http.StatusInternalServerError)
			return
		}
		defer dst.Close()

		io.Copy(dst, file)

		audioUrl := fmt.Sprintf("http://192.168.100.225:8080/uploads/voice/%s", filename)

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
			hub.Broadcast <- wsBytes
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{
			"status":   "success",
			"audioUrl": audioUrl,
		})
	}
}
