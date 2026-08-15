-- Seed data: leave types + Thai public holidays.

INSERT OR REPLACE INTO leave_types (id, code, label_th, label_en, color, default_days, counts_quota, sort_order) VALUES
	(1, 'annual',   'ลาพักร้อน', 'Annual',   '#2563eb', 10, 1, 1),
	(2, 'sick',     'ลาป่วย',    'Sick',     '#dc2626', 30, 1, 2),
	(3, 'personal', 'ลากิจ',     'Personal', '#7c3aed',  3, 1, 3),
	(4, 'unpaid',   'ลาไม่รับค่าจ้าง', 'Unpaid', '#64748b', 0, 0, 4);

-- ---------------------------------------------------------------------------
-- Thai public holidays.
--
-- ONLY fixed-date holidays are seeded below. Deliberately NOT included:
--   * Buddhist lunar holidays (Makha Bucha, Visakha Bucha, Asahna Bucha, Khao
--     Phansa) — these move every year and are set by the lunar calendar.
--   * Substitution days when a holiday falls on a weekend.
--   * Special one-off government holidays, which are announced with only weeks
--     of notice.
--
-- Add those through /admin once announced. See docs/ISSUES.md #10.
-- A missing holiday means leave booked on it silently costs the employee a day
-- of quota, so this list is worth keeping current.
-- ---------------------------------------------------------------------------

INSERT OR IGNORE INTO holidays (date, label) VALUES
	-- 2026 (remainder of year)
	('2026-08-12', 'Queen Mother''s Birthday / Mother''s Day'),
	('2026-10-13', 'King Bhumibol Memorial Day'),
	('2026-10-23', 'Chulalongkorn Day'),
	('2026-12-05', 'King Bhumibol Birthday / Father''s Day'),
	('2026-12-10', 'Constitution Day'),
	('2026-12-31', 'New Year''s Eve'),

	-- 2027
	('2027-01-01', 'New Year''s Day'),
	('2027-04-06', 'Chakri Memorial Day'),
	('2027-04-13', 'Songkran'),
	('2027-04-14', 'Songkran'),
	('2027-04-15', 'Songkran'),
	('2027-05-01', 'Labour Day'),
	('2027-05-04', 'Coronation Day'),
	('2027-06-03', 'Queen Suthida''s Birthday'),
	('2027-07-28', 'King Vajiralongkorn''s Birthday'),
	('2027-08-12', 'Queen Mother''s Birthday / Mother''s Day'),
	('2027-10-13', 'King Bhumibol Memorial Day'),
	('2027-10-23', 'Chulalongkorn Day'),
	('2027-12-05', 'King Bhumibol Birthday / Father''s Day'),
	('2027-12-10', 'Constitution Day'),
	('2027-12-31', 'New Year''s Eve');
