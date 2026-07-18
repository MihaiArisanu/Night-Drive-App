DROP INDEX IF EXISTS users_fcm_token_unique_idx;

ALTER TABLE users
    ALTER COLUMN fcm_token TYPE VARCHAR(255);
