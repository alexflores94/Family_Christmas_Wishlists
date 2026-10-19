// Family Wishlist mailer: a tiny Google Apps Script that sends the family emails.
// The database calls this web app when someone submits a list and for the
// 3-day reminders. Emails come from the Google account that deploys the script.
//
// 1. Replace SECRET below with a long random string (20+ characters).
// 2. Run the "sendTestEmail" function once and approve the permission prompt.
// 3. Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone.
// 4. Copy the web app URL and the same SECRET into backend/setup.sql.

var SECRET = 'PASTE-A-LONG-RANDOM-SECRET-HERE';

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.secret !== SECRET) {
      return reply_({ ok: false, error: 'unauthorized' });
    }
    var recipients = [].concat(data.to || []).slice(0, 10);
    var sent = 0;
    recipients.forEach(function (address) {
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
        MailApp.sendEmail({
          to: address,
          subject: String(data.subject || 'Family Wishlist').slice(0, 200),
          htmlBody: String(data.html || ''),
          name: 'Family Wishlist'
        });
        sent++;
      }
    });
    return reply_({ ok: true, sent: sent });
  } catch (err) {
    return reply_({ ok: false, error: String(err) });
  }
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Run this once from the editor to approve permissions and confirm email works.
function sendTestEmail() {
  var me = Session.getActiveUser().getEmail();
  MailApp.sendEmail(me, 'Family Wishlist mailer works',
    'If you can read this, the Family Wishlist mailer is set up.');
}
