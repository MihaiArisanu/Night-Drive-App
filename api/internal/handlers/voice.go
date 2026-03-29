package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/MihaiArisanu/nightdrive-backend/internal/ws"
)

func UploadVoiceHandler(hub *ws.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		err := r.ParseMultipartForm(10 << 20)
		if err != nil {
			http.Error(w, "File too large", http.StatusBadRequest)
			return
		}

		groupId := r.FormValue("groupId")
		senderId := r.FormValue("senderId")
		senderName := r.FormValue("senderName")

		if groupId == "" || senderId == "" || senderName == "" {
			http.Error(w, "Missing required fields", http.StatusBadRequest)
			return
		}

		file, handler, err := r.FormFile("audio")
		if err != nil {
			http.Error(w, "Invalid audio file", http.StatusBadRequest)
			return
		}
		defer file.Close()

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
