INSERT INTO users (username, tag, email, password_hash, location) VALUES
('Traian_Buddy', '1001', 'friend1@test.nightdrive.ro', crypt('123456', gen_salt('bf')), ST_SetSRID(ST_MakePoint(24.351311, 45.078953), 4326)),
('Ostrov_Target', '1002', 'friend2@test.nightdrive.ro', crypt('123456', gen_salt('bf')), ST_SetSRID(ST_MakePoint(24.371958, 45.092909), 4326)),
('Ghost_Friend', '1003', 'friend3@test.nightdrive.ro', crypt('123456', gen_salt('bf')), NULL),
('Sibiu_Rider', '1004', 'sibiu_req@test.nightdrive.ro', crypt('123456', gen_salt('bf')), ST_SetSRID(ST_MakePoint(24.1256, 45.7983), 4326));

INSERT INTO friendships (user_id_1, user_id_2)
SELECT 
    LEAST(u_me.id, u_friend.id), 
    GREATEST(u_me.id, u_friend.id)
FROM users u_me
CROSS JOIN users u_friend
WHERE u_me.email = 'mihai.arisanu2006@gmail.com' 
  AND u_friend.email IN (
      'friend1@test.nightdrive.ro', 
      'friend2@test.nightdrive.ro', 
      'friend3@test.nightdrive.ro'
  )
ON CONFLICT DO NOTHING;

INSERT INTO friend_requests (sender_id, receiver_id, status)
SELECT 
    u_sender.id, 
    u_me.id,
    'pending'
FROM users u_sender
CROSS JOIN users u_me
WHERE u_sender.email = 'sibiu_req@test.nightdrive.ro'
  AND u_me.email = 'mihai.arisanu2006@gmail.com'
ON CONFLICT DO NOTHING;

INSERT INTO events (user_id, event_type, location, description)
SELECT 
    id, 
    'police', 
    ST_SetSRID(ST_MakePoint(24.3720, 45.1020), 4326), 
    'Echipaj radar în Centru'
FROM users 
WHERE email = 'friend1@test.nightdrive.ro';