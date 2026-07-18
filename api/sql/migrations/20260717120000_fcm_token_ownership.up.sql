ALTER TABLE users
    ALTER COLUMN fcm_token TYPE TEXT;

WITH duplicate_tokens AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY fcm_token
               ORDER BY created_at DESC, id DESC
           ) AS token_owner_rank
    FROM users
    WHERE fcm_token IS NOT NULL
)
UPDATE users
SET fcm_token = NULL
FROM duplicate_tokens
WHERE users.id = duplicate_tokens.id
  AND duplicate_tokens.token_owner_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS users_fcm_token_unique_idx
    ON users(fcm_token)
    WHERE fcm_token IS NOT NULL;
