-- Interface language, per person.
--
-- Stored in D1 rather than localStorage for the same reason as week_start: the
-- pages are rendered on the server, so the preference has to reach the Worker —
-- and it then follows someone between their laptop and their phone.
--
-- 'en' remains the default so nobody's interface changes language underneath
-- them; Thai is chosen from /me.

ALTER TABLE users ADD COLUMN lang TEXT NOT NULL DEFAULT 'en';
