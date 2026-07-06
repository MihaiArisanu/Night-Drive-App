package db

import (
	"context"
	"log"
	"os"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

func NewMinioClient() (*minio.Client, error) {
	endpoint := os.Getenv("MINIO_ENDPOINT")
	if endpoint == "" {
		endpoint = "localhost:9000"
	}

	accessKeyID := os.Getenv("MINIO_USER")
	secretAccessKey := os.Getenv("MINIO_PASSWORD")
	useSSL := false

	minioClient, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKeyID, secretAccessKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, err
	}

	ctx := context.Background()
	bucketName := "avatars"

	err = minioClient.MakeBucket(ctx, bucketName, minio.MakeBucketOptions{})
	if err != nil {
		exists, errBucketExists := minioClient.BucketExists(ctx, bucketName)
		if errBucketExists == nil && exists {
			log.Printf("Bucket-ul '%s' există deja.", bucketName)
		} else {
			return nil, err
		}
	} else {
		policy := `{"Version": "2012-10-17", "Statement": [{"Action": ["s3:GetObject"], "Effect": "Allow", "Principal": "*", "Resource": ["arn:aws:s3:::avatars/*"]}]}`
		err = minioClient.SetBucketPolicy(ctx, bucketName, policy)
		if err != nil {
			log.Printf("Avertisment: Nu s-a putut seta politica publică pentru bucket: %v", err)
		}
		log.Printf("Bucket-ul '%s' a fost creat cu succes.", bucketName)
	}

	return minioClient, nil
}
