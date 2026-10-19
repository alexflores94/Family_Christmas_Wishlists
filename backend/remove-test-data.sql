-- Removes ALL lists, items and purchases. Run this once after testing, before the family starts.
-- Do not run it later: it erases real lists too. Family emails and settings are kept.
delete from public.purchases;
delete from public.lists;
delete from public.items;
