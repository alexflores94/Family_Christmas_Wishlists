-- Optional test data: last year's (2025) wishes, so you can try every feature before the family joins.
-- Jorge, Brianne, Mom and Dad get submitted lists. Alex's items are a DRAFT, so you can try the Submit button
-- (that also sends the 'shared their list' email). A few sample purchases are included.
-- Run this AFTER setup.sql. When you are done testing, run remove-test-data.sql.

insert into public.items (owner, name, description, link, price, price_as_of, position) values
  ('jorge', 'Multi tool', 'Leatherman multi-tool', 'https://a.co/d/4fa050f', null, null, 0),
  ('jorge', 'Mini flash lite', 'Flashlight', 'https://a.co/d/7PIaBx7', null, null, 1),
  ('jorge', 'Corduroy', 'Poncho shirt the dusty burro color', 'https://www.ponchooutdoors.com/products/the-dusty-burro?variant=45877710782772', '$109.95', 'Oct 19, 2026', 2),
  ('jorge', 'Howler shirt', 'Over shirt in duck brown', 'https://howlerbros.com/products/iquitos-overshirt-duck-brown?variant=42405456871539', '$99.00 (sale, was $125.00)', 'Oct 19, 2026', 3),
  ('jorge', 'Travel bag', 'Beis weekender bag in black', 'https://beistravel.com/products/the-weekender-in-black', '$118', 'Oct 19, 2026', 4),
  ('jorge', 'iPad case', 'ESR iPad case (iPad pro 13inch m2)', 'https://www.amazon.com/dp/B0CRHJNCY5', null, null, 5),
  ('brianne', 'Beis Weekender Bag', 'Maple brown', 'https://beistravel.com/products/the-weekender-in-maple', '$118', 'Oct 19, 2026', 0),
  ('brianne', 'Air Purifier', 'See link for details', 'https://a.co/d/fD5rhQC', null, null, 1),
  ('brianne', 'Reusable nespresso pods', 'Vertuo style pods', 'https://a.co/d/f7Ya6aH', null, null, 2),
  ('brianne', 'Pillow covers', 'Tan checkered', 'https://a.co/d/0JWPsX0', null, null, 3),
  ('brianne', 'Titanium Cutting board', 'See link for details', 'https://a.co/d/7xA0h9P', null, null, 4),
  ('brianne', 'Pots and Pans', 'Black', 'https://a.co/d/437W9os', null, null, 5),
  ('brianne', 'Mandoline', 'See link for details', 'https://a.co/d/3sEZgro', null, null, 6),
  ('brianne', 'Baggu Shoulder Bag', 'Leopard or Black', 'https://baggu.com/products/nylon-shoulder-bag-leopard', '$58', 'Oct 19, 2026', 7),
  ('brianne', 'Slip on checkered vans', 'Wide width size 10', 'https://www.vans.com/en-us/p//en-usshoes-00081/shoes/wides-5655/classic-slip-on-checkerboard-wide-shoe-VN0A4BHOTYQ', '$65', 'Oct 19, 2026', 8),
  ('brianne', 'Hats', 'Black or grey', 'https://a.co/d/5bechMT', null, null, 9),
  ('mom', 'Pressure cooker', 'Any pressure cooker that is on sale. Not the double one, because the air frying is tiny.', null, null, null, 0),
  ('mom', 'Vintage toaster', 'See link for the style', 'https://www.amazon.com/hz/mobile/mission/?_encoding=UTF8&p=gtBgemlY3%2Fb13DoNbGA6635IaKViShNI%2FmanBeNLP8WdAMHuXVvnsynRzLKYTMyvr6Lp%2FHz4kMTFz4cIfOfLiBNm62w8KNfZ2kVyfCIEoFvrQHbCjsOawPD0yrtxHwxHdbTM2VIKr8tiBT8LLDFQTU7%2BgMtPthKtL6p21Rg7KYciXFOYRxonBg9vVPL64Mkjmf1jiOj3uGuXk%2FFzgv%2Fi3k%2F8TKMNAgat9mICt0NZI%2Bx7nvFUBsw7uA5Juks%2BXG89slNTs7R1cw%2Bm7M5h385cBryJ3YNIVdhoQLswHe3TBuBjqHJzby9Lcx874sbw8MUDpZeCLN20lhOgFPcvA%2BItrKzLTki7TlfL6QACnWSrn3inOT%2BkNvH04oOE%2BOEBTI0H&ref_=ci_mcx_mi&pd_rd_w=90Hph&content-id=amzn1.sym.3e29b803-cc13-4d54-b101-dec8d809f0c8%3Aamzn1.symc.9fb0c8e5-ff72-45c8-8b37-eb7f9aab5731&pf_rd_p=3e29b803-cc13-4d54-b101-dec8d809f0c8&pf_rd_r=F7BG1J872G625PWP34EZ&pd_rd_wg=xTIYO&pd_rd_r=5593021f-d6d5-43b3-8e33-8933e1b0b391', null, null, 1),
  ('mom', 'Artwork for living room', 'See link for an example', 'https://www.amazon.com/gp/product/B0CYZWSWDX', null, null, 2),
  ('mom', 'Phone holder for my quad', 'Any sturdy one', null, null, null, 3),
  ('mom', 'Compression socks', 'Any amount is great, I use them every day', 'https://www.amazon.com/gp/product/B00J8OQRG0', null, null, 4),
  ('mom', 'Quad cover', 'See link for details', 'https://www.amazon.com/gp/product/B0CSYPBC7V', null, null, 5),
  ('mom', 'Bath and Body candles and hand soap', 'No flower smells', null, null, null, 6),
  ('dad', 'Air fryer', 'Any one on sale should do the trick.', null, null, null, 0),
  ('dad', 'Towel warmer', 'Saw one at Costco looks good', null, null, null, 1),
  ('dad', 'Mini hand chainsaw', 'Home Depot brand', null, null, null, 2),
  ('dad', 'T shirt', 'Large', null, null, null, 3),
  ('dad', 'Pillow', 'Farola ergo cervical neck pillow', null, null, null, 4),
  ('alex', 'Glass Bowls', 'Set of mixed sizes glass bowls needed for baking/cooking. Doesn''t have to be exact link, just an example.', 'https://www.amazon.com/HillSpring-Sizes-Spices-Chopped-Ingredients/dp/B0CP28D2CJ', null, null, 0),
  ('alex', 'Pots', 'Cooking pot set with small, med, and large sizes. Link for example.', 'https://www.amazon.com/MICHELANGELO-Saucepan-Stainless-Induction-Compatible/dp/B0CFH6BWSZ', null, null, 1),
  ('alex', 'Gift cards', 'Barnes and Nobles, Amazon, Doordash, Costco, Car Wash', null, null, null, 2),
  ('alex', 'Wireless CarPlay Adapter', 'Connect to music without cord', 'https://www.amazon.com/Wireless-CarPlay-%EF%BC%86Android-Connection-CarPlay%EF%BC%86Android/dp/B0FJLQWYPL', null, null, 3),
  ('alex', 'Bonsai Starter Kit', 'Grow a bonsai tree', 'https://www.amazon.com/Planters-Choice-Bonsai-Starter-Comprehensive/dp/B06XH2ZDTM', null, null, 4),
  ('alex', 'Surprise!', 'Surprise me this year with something unexpected. I love walking down the aisles of Costco for inspiration.', null, null, null, 5);

insert into public.lists (owner, submitted_at) values
  ('jorge', now()), ('brianne', now()), ('mom', now()), ('dad', now())
on conflict (owner) do update set submitted_at = excluded.submitted_at;

-- Sample purchases (made by other people, so Alex can see them but the list owners cannot).
insert into public.purchases (item_id, buyer)
select i.id, v.buyer from (values
  ('jorge',   'iPad case',          'brianne'),
  ('brianne', 'Hats',               'dad'),
  ('mom',     'Compression socks',  'jorge')
) as v(owner, item, buyer)
join public.items i on i.owner = v.owner and i.name = v.item;
