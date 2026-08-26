-- Planned medical leave.
--
-- Distinct from sick leave on purpose: sick leave is unplanned and entered
-- after the fact, this is a scheduled appointment, procedure or follow-up that
-- someone books in advance like any other absence. Keeping them apart is the
-- point — it stops planned treatment quietly eating an allowance meant for
-- being unexpectedly ill.
--
-- `counts_quota = 0`, so it is recorded but never refused. That is the only
-- honest default without knowing the company's policy: a quota of 0 with
-- counts_quota = 1 would reject every booking, and inventing an allowance
-- would be inventing policy. It behaves like unpaid leave — /me shows days
-- taken and "no annual allowance".
--
-- To give it an allowance later:
--
--   UPDATE leave_types SET counts_quota = 1, default_days = 5 WHERE code = 'medical';
--
-- `default_days` only seeds *new* quota rows, so after that change existing
-- people keep the 0 they were given here. Set theirs from /admin — the bulk
-- field does the whole active roster at once.
--
-- The colour is the furthest from the four already in use, checked both for
-- that and for text contrast in either theme. Deliberately not red: it sits
-- next to sick leave in every list and the two must not be mistaken for each
-- other at a glance.

INSERT OR IGNORE INTO leave_types (id, code, label_th, label_en, color, default_days, counts_quota, sort_order)
	VALUES (5, 'medical', 'ลาพบแพทย์', 'Planned medical', '#059669', 0, 0, 3);

-- Ordered next to sick leave rather than tacked on the end, since that is
-- where someone looks for it. Presentation only.
UPDATE leave_types SET sort_order = 4 WHERE code = 'personal';
UPDATE leave_types SET sort_order = 5 WHERE code = 'unpaid';
