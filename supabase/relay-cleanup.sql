-- Arena — Figma Agent Bridge: relay housekeeping (run anytime in the SQL Editor)
-- Purge finished work older than 1 day
delete from public.arena_figma_commands where status in ('done','error') and created_at < now() - interval '1 day';
delete from public.arena_figma_events  where created_at < now() - interval '1 day';
delete from public.arena_figma_exports where created_at < now() - interval '1 day';

-- Un-stick commands left 'running' by a crashed/interrupted build
update public.arena_figma_commands
set status = 'error', error = 'cleared manually'
where status = 'running';

-- Optional: see live state per session
-- select session_id, status, count(*) from public.arena_figma_commands group by 1, 2 order by 1, 2;
