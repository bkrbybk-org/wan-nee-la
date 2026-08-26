-- Per-note visibility (docs/ISSUES.md #17).
--
-- Until now every note was readable by everyone, and the field gave no hint of
-- that — which was the actual problem, more than the sharing itself. Each note
-- now carries its own answer.
--
-- The default is private, and that applies to rows written before this column
-- existed as well. Their authors were never offered a choice, so the only safe
-- reading of their intent is the conservative one: restricting a note that was
-- already visible loses some shared context, while publishing one written in
-- confidence cannot be undone.

ALTER TABLE leave_requests ADD COLUMN note_private INTEGER NOT NULL DEFAULT 1;
