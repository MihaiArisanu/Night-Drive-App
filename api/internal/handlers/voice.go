package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"time"
)

const voiceUploadRoot = "./uploads/voice"

func voiceOwnerDirectory(userID string) string {
	digest := sha256.Sum256([]byte(userID))
	return hex.EncodeToString(digest[:])
}

func deleteUserVoiceFiles(userID string) error {
	return os.RemoveAll(filepath.Join(voiceUploadRoot, voiceOwnerDirectory(userID)))
}

func StartVoiceRetentionWorker(ctx context.Context, retention time.Duration) {
	cleanupVoiceFiles(retention)
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cleanupVoiceFiles(retention)
		}
	}
}

func cleanupVoiceFiles(retention time.Duration) {
	cutoff := time.Now().Add(-retention)
	_ = filepath.WalkDir(voiceUploadRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err == nil && info.ModTime().Before(cutoff) {
			_ = os.Remove(path)
		}
		return nil
	})
}
