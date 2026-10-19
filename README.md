# Family Wishlist: setup guide

About 40 minutes, no coding. Everything below has a free plan.

## What you are setting up

| Piece | Job | Where it lives |
|---|---|---|
| The website | The pages your family uses | GitHub Pages (`site/` folder) |
| The database | Stores lists and purchases, hides purchases from the list owner, signs people in with an emailed code | Supabase |
| The mailer | Sends "Jorge shared his list" and the 3-day reminders | A small Google Apps Script on your Gmail |

## Two folders, two rules

- `site/` is the website. It has no secrets and is the only folder that should ever go in a public repository.
- `backend/` is the database setup and the mailer script. In this private repo they hold only placeholders, which is fine. **Do not commit real family emails or your mailer secret.** Edit a copy of `setup.sql` on your computer (or straight in the Supabase SQL Editor) and keep that copy out of the repo.

## What happens, and when

- Sign in: type your email, get a 6-digit code, type it in. Only the five family emails work.
- A person submits their list: the other four get an email.
- Reminders: every 3 days starting Thanksgiving, at 9:00 AM Pacific, to anyone who has not submitted. For 2026 that is Nov 26, Nov 29, Dec 2, 5, 8, 11, 14, 17, 20 and 23. It stops once a person submits, and never sends on or after Dec 25.

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
   - Sender name: `Family Wishlist`
   - Host: `smtp.gmail.com`
   - Port: `465`
   - Username: your Gmail address
   - Password: the 16-letter app password
3. Open **Authentication > Emails > Templates**. There are two templates that matter: **Confirm sign up** (used the first time someone signs in) and **Magic Link** (used afterward). Set both to the following so the email shows a code instead of a link. Change the subject to `Your Family Wishlist code`.

```html
<h2>Your sign-in code</h2>
<p>Enter this code on the Family Wishlist site:</p>
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

1. Open `backend/setup.sql` in any text editor.
2. **EDIT ME 1:** replace the five `PUT-...-EMAIL-HERE@example.com` values with each person's email. Use the address they will type to sign in. Keep the names `alex`, `jorge`, and so on exactly as they are.
3. **EDIT ME 2:** replace the three settings:
   - `site_url`: leave it for now, you will fix it in Step 6
   - `mailer_url`: the Apps Script web app URL from Step 3
   - `mailer_secret`: the same secret string you put in the script
4. In Supabase open **SQL Editor > New query**, paste the whole edited file, and click **Run**. You should see "Success". If it complains about `pg_cron` or `pg_net`, open **Database > Extensions**, switch both on, and run it again.

Running it again later is safe. It never deletes lists.

## Step 5. Put the website on GitHub Pages

1. Open `site/config.js` and paste in your Project URL and anon key from Step 1.
2. On github.com click **New repository**. Name it (for example `family-wishlist`), choose **Public**, and create it.
3. Click **Add file > Upload files** and drag in the three files from `site/`: `index.html`, `app.js`, `config.js`. Commit. Do not upload anything from `backend/`. (This repo is private, and GitHub Pages on a private repo needs a paid GitHub plan, so on a free account use a separate public repo that holds only these three files.)
4. Open **Settings > Pages**. Under Source choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and Save. After a minute the page shows your address, such as `https://yourname.github.io/family-wishlist/`.

## Step 6. Tell the database the website address

In Supabase SQL Editor run this, using your real address:

```sql
update public.app_settings set value = 'https://yourname.github.io/family-wishlist/' where key = 'site_url';
```

The emails use it for their "Open the wishlist" button.

## Step 7. Test it, then clear the test data

1. Optional: run `backend/optional-test-data.sql` in the SQL Editor. It loads last year's lists for Jorge, Brianne, Mom and Dad and leaves Alex's as a draft, so you can try everything.
2. Open your site and sign in with your own email. You should get a code within a minute or so. Check spam the first time.
3. Try: submit Alex's draft (the other four should get an email), mark items purchased on someone's list, and look at the Purchases tab.
4. To check the mailer on its own, run this with your own address:

```sql
select public.send_mail(array['you@example.com'], 'Test', '<p>It works</p>');
```

   If nothing arrives, look at Executions in the Apps Script project, and run `select * from net._http_response order by created desc limit 5;` in Supabase.
5. When you are done, run `backend/remove-test-data.sql`. **Do it before the family starts**, because it erases every list.
6. Send the family the site address.

---

## Good to know

- **Purchases are hidden by the database.** The list owner's account is refused those rows, so they cannot be found by looking at the page's code. The Purchases tab only ever shows gifts you bought for other people.
- **Deleting an item that someone already bought** removes their purchase mark too.
- **Changing an email:** `update public.member_emails set email = 'new@example.com' where key = 'mom';` (use the person's key).
- **Free Supabase projects can pause when nobody uses them for a while.** If the site stops loading, open the Supabase dashboard and restore the project.
- **Reminders run from the database.** To try one by hand, `select public.send_reminders('2026-11-29');` pretends today is Nov 29 and really emails everyone who has not submitted, so only run it when that is fine.
- **Emails come from your Gmail address**, for both the sign-in codes and the notifications.
