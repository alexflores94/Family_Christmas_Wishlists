# Wish Orbit: setup guide

About 40 minutes, no coding. Everything below has a free plan.

## What you are setting up

| Piece | Job | Where it lives |
|---|---|---|
| The website | The pages people use | Vercel (the `site/` folder) |
| The database | Stores groups, lists and purchases, hides purchases from the list owner, signs people in with an emailed code | Supabase |
| The mailer | Sends the "Jorge shared his list" emails | A small Google Apps Script on your Gmail |

## Upgrading from the single-family version

If the family site already works, you only need two steps:

1. In Supabase open **SQL Editor > New query**, paste all of `backend/setup.sql`, and click **Run**. No edits are needed. Your settings are kept. The five family members, their lists and their purchases move into a group called **Family Christmas** (event date Dec 25, minimum 3, Alex is the admin). The old tables stay as a backup named `legacy_*`.
2. Push the new `site/` files. Vercel redeploys on its own.

Everyone signs in with the same emails as before and finds Family Christmas on their dashboard.

(If you ran an earlier draft of the groups `setup.sql` that was posted before this version, the script stops with a message instead of changing anything. Let Claude know and it will write the upgrade.)

## Two folders, two rules

- `site/` is the website. It has no secrets and is the only folder that should ever go in a public repository.
- `backend/` is the database setup and the mailer script. In this private repo they hold only placeholders, which is fine. **Do not commit real family emails or your mailer secret.** Edit a copy of `setup.sql` on your computer (or straight in the Supabase SQL Editor) and keep that copy out of the repo.

## What happens, and when

- **Sign in:** type your email, get a 6-digit code, type it in. Anyone with an invite link can create an account the same way.
- **Groups:** anyone signed in can create a group with a name, event date and item minimum. The creator is its admin.
- **Invite link:** the admin copies a link from the group's Manage tab. Opening it asks for an email, then a first and last name for new people, then to join. A new link switches the old one off.
- **Archive:** the admin can archive a group. It moves to an **Archived** tab on everyone's dashboard and becomes view-only: no one can join, add or edit lists, or mark purchases, and the buttons are greyed out. Only the admin can reopen it.
- **Quantity:** each wish can have a quantity (default 1) or Unlimited. A wish with more than one stays available to others until every one is claimed, and shows who else picked it up.
- **Photo and price from a link:** when you paste a product link on an item, the site looks the page up and fills in a photo and the price (with the date it was found), which you can edit or remove. Photos show on the list and on the Purchases tab. When you mark an item as purchased, the amount you paid starts at the item's listed price (change it if you paid something different); the Purchases totals use it. This runs through a small Vercel function (`site/api/preview.js`, served at `/api/preview`) that needs no setup and only works for signed-in people. Some stores (Amazon is the usual one) block automated lookups or load prices with JavaScript, so for those you'll get no photo or price and can type the price yourself. Optional: add an environment variable `SUPABASE_URL` (your project URL) in Vercel so only your own project's sign-ins can use it.
- **Lists for other people (in a group):** on the Everyone tab, any member can **make a list for someone else**, such as a child who doesn't use the site. You can view, edit, rename and delete the lists you made. Everyone in the group sees them and can mark gifts as purchased, and you can see who picked what. When you buy from one, it's recorded under your own login, never under the child's list. The first time a child list has items, the rest of the group gets a "shared a wishlist for <name>" email (once; the author and the placeholder lists never receive it). Child lists have no minimum, don't count as members, and are removed if you're removed from the group.
- **Purchase details (Purchases tab):** for every gift you've marked, you see the item link, the store it comes from (taken from the link), the price you paid, a private note, a tracking link and an "it has arrived" checkbox. Each item shows a status: Purchased, On its way (tracking added) or In hand, with totals and a by-store summary at the top. Only you can see your notes, tracking and prices. Releasing a purchase clears them.
- **Wishlists (one-way lists):** the **New wishlist** button makes a list you write for other people, like a birthday or a Christmas list for your kids. Enter an event name, a date and who the first list is for, then add as many items as you like and as many lists for other people as you need. Share the invite link from the Manage tab. People who open it can see every list and mark gifts as purchased (with their own private price paid), but have no way to make lists of their own. You, as the admin, can see who picked what. Wishlists archive after the event date like groups do.
- **Auto-archive:** a group archives itself the day after its event date (counted in the time zone stored in `app_settings`, default `America/Los_Angeles`; change it with `update public.app_settings set value = 'America/New_York' where key = 'timezone';`). To bring it back, the admin picks a new date on the Manage tab.
- **Edit and remove (admin, Manage tab):** rename the group, move the event date, or remove a member. Removing someone deletes their list and everything they picked, and frees any items they had claimed. They can rejoin only with an invite link, so make a new link if you want the old one switched off. Archived groups can't be edited.
- **Prices paid:** on any item you've picked you can enter what you paid. The Purchases tab totals it per list and across all lists. Only you can see your prices; not the list's owner, and not other shoppers.
- **Tab order in a group:** until you've shared your own list, **My list** is the first tab and the page a group opens on, so it's the first thing you fill in. Once your list is shared, it moves to after **Purchases** and the group opens on **Everyone**. (Your list is still one click away, and Manage stays last.)
- **Admin page (owner only):** an **Admin** button appears on your dashboard when you sign in with the email stored in the `owner_email` setting (set to `alexander.flores1030@gmail.com`). It shows totals (people, groups, wishlists, lists started and shared, items, gifts picked), daily bar charts for the last 30 or 90 days (new people, lists started, groups and wishlists created) and a searchable list of **every group** with its name, member count, item count, event date, created date and creator. Click a group to see all of its lists and items in a read-only **admin view**: nothing in it can be edited, and it shows how many of each item have been picked but not who picked them. The database checks the email on every request, so nobody else can read any of it, and it never shows anyone's email address. To change the owner: `update public.app_settings set value = 'new@email.com' where key = 'owner_email';`. It counts sign-ups and lists, not page views; the site doesn't track visits.
- **New orbit:** the dashboard (headed **Your wish orbits**) has one **New orbit** button. It asks whether you want a **group event** (everyone writes their own list; the creation screen explains how sharing works) or a **one-way wishlist**, then opens the matching creation screen.
- **About page (landing page):** people who aren't signed in land on an About page that explains what Wish Orbit does and why it helps, with six sample screens (`site/img/about-*.webp`) and a **Sign in or create an account** button at the top and bottom. The button opens the email-code sign-in, which has an "About Wish Orbit" link back. Invite links skip the About page and go straight to joining. Signed-in people go straight to their dashboard.
- **Dashboard:** every group you are in, its created date, member count, and how many people you still have no purchase marked for.
- **Emails:** when someone submits a list, the rest of that group is emailed. When someone later edits a list that is already shared (adds, changes or removes wishes, or changes their About note), the group is emailed again, at most once per list every 30 minutes so a burst of edits is one email. In a Secret Santa, only the host is emailed when lists are shared, and only the person holding a list is emailed about its edits. There are no reminder emails.
- **About me note:** the top of every list has an **About me** box (up to 1000 characters) for recent hobbies, interests, sizes, or things you would rather not get. It is shown at the top of the list to everyone who can see the list, and it is saved with the list.
- **Purchases that aren't on a list:** the Purchases tab has **Add a purchase that isn't on a list**. Pick the person, then enter what you bought, a link, the price, a note and a tracking link. These show up under that person with the same status, tracking and arrived controls as listed gifts, count toward totals and the status summary, and count that person as shopped for. They are private to you.
- **Photo and price from a link:** there is no button. Paste a link and the photo and price fill in on their own (the same `/api/preview` function as before), and you can still edit or remove them.
- **Names:** everyone enters a first and last name the first time they sign in (people who signed up before this was added are asked once, on their next sign-in). Groups show only first names. When two people in the same group share a first name, each gets their last initial, like "Maria F." and "Maria J.", on screen and in emails. Other people never see a full last name, only that initial. Change your name from the account menu (tap your name, then **Change name**).
- **Feedback:** the account menu (tap your name) has **Send feedback**. People choose **suggestion** or **bug** and write up to 1000 characters (10 a day per person). On the Admin page, a **Feedback** log shows who sent each one (name and email), when, and the message, with **Mark resolved** and **Reopen**. Open feedback is also counted in the tiles at the top.
- **Secret Santa (third orbit type):** **New orbit > Secret Santa**. It works like a group, with these differences. Lists are private: nobody can read another player's list, and the host cannot either. Players can see who has joined and who has shared a list (the **Players** tab). The host is the only one emailed when lists are shared. When at least 3 players have shared, the host presses **Assign Secret Santas** (on the **Host** tab), reads a confirmation screen that lists who is in and who is left out, and confirms. This cannot be undone. Everyone who shared is given exactly one other player's list at random (never their own, and every list is given once), and each player is emailed. The assignment is stored so that only the giver can read their own row, so the host cannot see who has whom. Players then open their pick's list, mark gifts as purchased and track them, and can add purchases that aren't on the list. After the draw nobody can join, and players left out of the draw are told so. The owner's Admin view shows Secret Santa group totals but never the contents of the lists.

---

## Step 1. Create the Supabase project

1. Go to supabase.com and sign up (the "Continue with GitHub" button is fine).
2. Click **New project**. Name it `family-wishlist`, make up a database password (save it somewhere), pick the region closest to you, choose the Free plan, and click Create. Wait a couple of minutes.
3. Open **Project Settings > API**. Copy two things into a note for later:
   - the **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - the **anon public** key (or "publishable" key). This one is safe to publish. Never use the `service_role` key anywhere in this guide.

## Step 2. Let Supabase send sign-in codes through your Gmail

Supabase's built-in email only reaches people on your Supabase team and is limited to 2 emails an hour, so sign-in codes need their own sender.

1. In your Google account, turn on **2-Step Verification** if it is off, then create an **App password** (Google Account > Security > App passwords). Name it `wishlist` and copy the 16-letter password.
2. In Supabase open **Authentication > Emails > SMTP Settings** (the menu names move around sometimes, so look for "SMTP"). Turn on custom SMTP and fill in:
   - Sender email: your Gmail address
   - Sender name: `Wish Orbit`
   - Host: `smtp.gmail.com`
   - Port: `465`
   - Username: your Gmail address
   - Password: the 16-letter app password
3. Choose how long sign-in codes are. Open **Authentication > Sign In / Providers > Email** and set **Email OTP Length** to `6` (the default is 8). The site accepts 6 or more digits, so there is nothing to change in the code, and codes already in people's inboxes still work until they expire.
4. Open **Authentication > Emails > Templates**. There are two templates that matter: **Confirm sign up** (used the first time someone signs in) and **Magic Link** (used afterward). Set both to the following so the email shows a code instead of a link. Change the subject to `Your Wish Orbit code`.

```html
<h2>Your sign-in code</h2>
<p>Enter this code on the Wish Orbit site:</p>
<p style="font-size:28px;letter-spacing:4px"><strong>{{ .Token }}</strong></p>
<p>It expires in an hour. If you did not ask for it, ignore this email.</p>
```

## Step 3. Set up the mailer (Google Apps Script)

1. Go to script.google.com, signed in with the same Gmail, and click **New project**.
2. Delete the sample code and paste in everything from `backend/mailer-apps-script.gs`.
3. On the line `var SECRET = ...`, replace the text in quotes with a long random string (20+ letters and numbers). Copy that string to your note.
4. In the function dropdown at the top choose **sendTestEmail**, click **Run**, and approve the permission prompts (click Advanced > Go to project if Google warns you). You should get a test email.
5. Click **Deploy > New deployment**. Click the gear and choose **Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Click Deploy.
6. Copy the **Web app URL** (starts with `https://script.google.com/macros/s/`) to your note.

Gmail's free limit is roughly 100 recipients a day, far more than this site uses.

## Step 4. Set up the database

1. In `backend/setup.sql`, find the block marked **EDIT ME** and replace its three settings:
   - `site_url`: your site's address, such as `https://wishorbit.vercel.app/`
   - `mailer_url`: the Apps Script web app URL from Step 3
   - `mailer_secret`: the same secret string you put in the script
2. In Supabase open **SQL Editor > New query**, paste the whole edited file, and click **Run**. You should see "Success". If it complains about `pg_net`, open **Database > Extensions**, switch it on, and run it again.

Running it again is safe. It never deletes lists, and it never overwrites settings that are already filled in. To change a setting later, run `update public.app_settings set value = '...' where key = 'site_url';` (or `mailer_url`, `mailer_secret`).

Keep a copy with your real secret on your own computer, not in this repo.

## Step 5. Put the website on Vercel

1. Open `site/config.js` and paste in your Project URL and anon (publishable) key from Step 1.
2. In Vercel choose **Add New > Project**, import this repository, and set **Root Directory** to `site`. Leave Framework as **Other** and leave the build and output settings empty. Deploy.
3. Every push to `main` redeploys the site.

## Step 6. Tell the database the website address

In Supabase SQL Editor run this, using your real address:

```sql
update public.app_settings set value = 'https://wishorbit.vercel.app/' where key = 'site_url';
```

The emails use it for their "Open the wishlist" button.

## Step 7. Test it

1. Open your site and sign in with your email. You should get a code within a minute or so. Check spam the first time.
2. Create a group, copy its invite link from the Manage tab, and open the link in a private window to try joining as a second person.
3. Add a few wishes (try a quantity of 3 and Unlimited), submit, and mark purchases from the other account.
4. To check the mailer on its own, run this with your own address:

```sql
select public.send_mail(array['you@example.com'], 'Test', '<p>It works</p>');
```

   If nothing arrives, look at Executions in the Apps Script project, and run `select * from net._http_response order by created desc limit 5;` in Supabase.
5. To wipe test lists before real use, run `backend/remove-test-data.sql`. It erases every list in every group.

---

## Good to know

- **Purchases are hidden by the database.** The list owner's account is refused those rows, so they cannot be found by looking at the page's code. The Purchases tab only ever shows gifts you bought for other people.
- **Deleting an item that someone already bought** removes their purchase marks too.
- **Emails stay private.** People see each other's names only. The database refuses to return anyone's email to a signed-in user, and each person is identified inside the app by a private id.
- **Anyone with the site address can create an account**, but they can only see groups they have joined.
- **Changing someone's email:** their account is tied to the email they sign in with, so they should sign in with the new address and join the group again through its invite link.
- **Free Supabase projects can pause when nobody uses them for a while.** If the site stops loading, open the Supabase dashboard and restore the project.
- **Emails come from your Gmail address**, for both the sign-in codes and the notifications. Gmail's free limit is roughly 100 recipients a day, so very large groups could hit it.
