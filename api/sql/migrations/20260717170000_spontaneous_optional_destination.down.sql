UPDATE spontaneous_ride_offers
SET navigation_mode = 'zen'
WHERE navigation_mode = 'none';

ALTER TABLE spontaneous_ride_offers
    DROP CONSTRAINT spontaneous_ride_offers_navigation_mode_check;

ALTER TABLE spontaneous_ride_offers
    ADD CONSTRAINT spontaneous_ride_offers_navigation_mode_check
    CHECK (navigation_mode IN ('destination', 'zen'));
