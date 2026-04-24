INSERT INTO users (username, tag, email, password_hash, location) VALUES
('Vecin', '1001', 'close@test.nightdrive.ro', crypt('123456', gen_salt('bf')), ST_SetSRID(ST_MakePoint(24.364, 45.112), 4326)),

('Ostroveni', '1002', 'friend1@test.nightdrive.ro', crypt('123456', gen_salt('bf')), ST_SetSRID(ST_MakePoint(24.3700, 45.0850), 4326)),
('Nord', '1003', 'friend2@test.nightdrive.ro', crypt('123456', gen_salt('bf')), ST_SetSRID(ST_MakePoint(24.3600, 45.1150), 4326)),
('Zavoi', '1004', 'friend3@test.nightdrive.ro', crypt('123456', gen_salt('bf')), ST_SetSRID(ST_MakePoint(24.3580, 45.1100), 4326)),

('Traianu', '1005', 'stranger1@test.nightdrive.ro', crypt('123456', gen_salt('bf')), ST_SetSRID(ST_MakePoint(24.3680, 45.1080), 4326)),
('Goranu', '1006', 'stranger2@test.nightdrive.ro', crypt('123456', gen_salt('bf')), ST_SetSRID(ST_MakePoint(24.3750, 45.0950), 4326)),
('Bujoren', '1007', 'stranger3@test.nightdrive.ro', crypt('123456', gen_salt('bf')), ST_SetSRID(ST_MakePoint(24.3500, 45.1200), 4326)),
('Centru', '1008', 'stranger4@test.nightdrive.ro', crypt('123456', gen_salt('bf')), ST_SetSRID(ST_MakePoint(24.3720, 45.1020), 4326)),
('Libertatii', '1009', 'stranger5@test.nightdrive.ro', crypt('123456', gen_salt('bf')), ST_SetSRID(ST_MakePoint(24.3600, 45.0900), 4326));

INSERT INTO friendships (user_id_1, user_id_2)
SELECT 
    LEAST(u_me.id, u_friend.id), 
    GREATEST(u_me.id, u_friend.id)
FROM users u_me
CROSS JOIN users u_friend
WHERE u_me.email = 'mihai@arisanu.com' 
  AND u_friend.email IN (
      'close@test.nightdrive.ro', 
      'friend1@test.nightdrive.ro', 
      'friend2@test.nightdrive.ro', 
      'friend3@test.nightdrive.ro'
  )
ON CONFLICT DO NOTHING;

INSERT INTO events (user_id, event_type, location, description)
SELECT 
    id, 
    'police', 
    location, 
    'Echipaj la sensul giratoriu'
FROM users 
WHERE email = 'friend1@test.nightdrive.ro';