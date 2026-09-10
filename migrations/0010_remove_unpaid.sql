-- Remove unpaid leave.
--
-- The type was seeded in 0002 and never used: production had zero bookings
-- against it, in any status, and no audit rows. That is what makes deleting the
-- row safe rather than merely tidy — `ENTRY_FROM` in src/repo/db.ts joins
-- leave_types with an INNER JOIN, so a request pointing at a type that no
-- longer exists would not raise an error anywhere. It would simply stop being
-- returned: absent from the calendar, the feed, /me and the daily digest, with
-- the row still sitting in the table. Silent disappearance is a far worse
-- outcome than a leave type nobody wanted, so the delete below refuses to run
-- unless the type is genuinely unused.
--
-- The guard is not ceremony. This file may be applied to a database that is not
-- the one checked above — a developer's copy, or production some days later, by
-- which time somebody may have booked the thing. In that case the DELETE
-- matches nothing, the type survives, and whoever runs it can decide what to do
-- with the bookings rather than discovering they have vanished.
DELETE FROM leave_types
WHERE code = 'unpaid'
  AND NOT EXISTS (SELECT 1 FROM leave_requests WHERE leave_type_id = leave_types.id);

-- Quota rows for a type that no longer exists. Written by ensureQuotas for
-- every user in every year it seeded, and meaningless once the type is gone.
-- Scoped by "no matching type" rather than by id, so this also sweeps up
-- anything an earlier removal left behind.
DELETE FROM quotas WHERE leave_type_id NOT IN (SELECT id FROM leave_types);
