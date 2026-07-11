package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
)

const maxUploadSize = 5 * 1024 * 1024
const avatarBucketName = "avatars"

var avatarFileNamePattern = regexp.MustCompile(`^[0-9a-fA-F-]{36}\.(jpg|png|webp)$`)

func avatarObjectName(avatarURL string) (string, bool) {
	parsedURL, err := url.Parse(avatarURL)
	if err != nil {
		return "", false
	}
	markerIndex := strings.LastIndex(parsedURL.Path, "/avatars/")
	if markerIndex < 0 {
		return "", false
	}
	fileName := path.Base(parsedURL.Path[markerIndex+len("/avatars/"):])
	return fileName, avatarFileNamePattern.MatchString(fileName)
}

func ServeAvatarHandler(minioClient *minio.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}

		fileName := r.PathValue("filename")
		if !avatarFileNamePattern.MatchString(fileName) {
			RespondWithError(w, http.StatusNotFound, "avatar_not_found", "Avatar not found", nil)
			return
		}

		object, err := minioClient.GetObject(r.Context(), avatarBucketName, fileName, minio.GetObjectOptions{})
		if err != nil {
			RespondWithError(w, http.StatusBadGateway, "storage_unavailable", "Avatar storage unavailable", err)
			return
		}
		defer object.Close()

		info, err := object.Stat()
		if err != nil {
			response := minio.ToErrorResponse(err)
			if response.Code == "NoSuchKey" || response.Code == "NoSuchObject" || response.StatusCode == http.StatusNotFound {
				RespondWithError(w, http.StatusNotFound, "avatar_not_found", "Avatar not found", nil)
				return
			}
			RespondWithError(w, http.StatusBadGateway, "storage_unavailable", "Avatar storage unavailable", err)
			return
		}

		if info.ContentType != "" {
			w.Header().Set("Content-Type", info.ContentType)
		}
		if info.ETag != "" {
			w.Header().Set("ETag", `"`+info.ETag+`"`)
		}
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		http.ServeContent(w, r, fileName, info.LastModified, object)
	}
}

func UploadAvatarHandler(database *sql.DB, minioClient *minio.Client) http.HandlerFunc {
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

		r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize+(1024*1024))
		if err := r.ParseMultipartForm(maxUploadSize); err != nil {
			RespondWithError(w, http.StatusBadRequest, "invalid_avatar", "Invalid avatar upload", err)
			return
		}

		file, fileHeader, err := r.FormFile("avatar")
		if err != nil {
			RespondWithError(w, http.StatusBadRequest, "invalid_avatar", "Avatar file is required", nil)
			return
		}
		defer file.Close()
		if fileHeader.Size <= 0 || fileHeader.Size > maxUploadSize {
			RespondWithError(w, http.StatusRequestEntityTooLarge, "avatar_too_large", "Avatar must be smaller than 5MB", nil)
			return
		}

		buff := make([]byte, 512)
		bytesRead, readErr := io.ReadFull(file, buff)
		if readErr != nil && !errors.Is(readErr, io.ErrUnexpectedEOF) && !errors.Is(readErr, io.EOF) {
			RespondWithError(w, http.StatusBadRequest, "invalid_avatar", "Could not read avatar file", readErr)
			return
		}

		filetype := http.DetectContentType(buff[:bytesRead])
		if filetype != "image/jpeg" && filetype != "image/png" && filetype != "image/webp" {
			RespondWithError(w, http.StatusUnsupportedMediaType, "unsupported_avatar_type", "Only JPEG, PNG and WEBP images are allowed", nil)
			return
		}

		if _, err = file.Seek(0, io.SeekStart); err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Eroare internă", nil)
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
		ctx := r.Context()

		_, err = minioClient.PutObject(ctx, avatarBucketName, newFileName, file, fileHeader.Size, minio.PutObjectOptions{
			ContentType: filetype,
		})
		if err != nil {
			RespondWithError(w, http.StatusBadGateway, "storage_unavailable", "Could not store avatar", err)
			return
		}

		avatarURL := fmt.Sprintf("/api/v1/avatars/%s", newFileName)

		previousAvatarURL, err := db.ReplaceAvatar(ctx, database, userID, avatarURL)
		if err != nil {
			minioClient.RemoveObject(context.Background(), avatarBucketName, newFileName, minio.RemoveObjectOptions{})
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Could not update profile avatar", err)
			return
		}

		if previousObjectName, ok := avatarObjectName(previousAvatarURL); ok && previousObjectName != newFileName {
			cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := minioClient.RemoveObject(cleanupCtx, avatarBucketName, previousObjectName, minio.RemoveObjectOptions{}); err != nil {
				log.Printf("[WARN] Could not remove previous avatar %s: %v", previousObjectName, err)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"message":             "Avatar updated successfully",
			"avatar_url":          avatarURL,
			"profile_picture_url": avatarURL,
		})
	}
}
