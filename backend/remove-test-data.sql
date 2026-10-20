-- Removes ALL wishlist items, shared lists and purchase marks in EVERY group.
-- Groups, members and settings are kept. Run it once after testing, before real use.
-- Do not run it later: it erases real lists too.
delete from public.claims;
delete from public.wish_items;
delete from public.wish_lists;
