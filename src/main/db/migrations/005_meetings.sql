-- Persist enough about meeting invites to render the invite block on
-- re-view and to drive the index-level "this is an invite" indicator
-- without refetching. is_meeting is the cheap boolean used by message
-- list rendering; meeting_info is the full JSON-encoded MeetingInfo
-- only populated once the full message has been fetched (Graph's
-- event $expand only comes through /me/messages/{id}, not the list
-- endpoint).

ALTER TABLE messages ADD COLUMN is_meeting INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN meeting_info TEXT;
