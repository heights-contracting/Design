# Login backend – one-time setup (about 3 minutes)

The Design home page checks the username/password with a small Google Apps Script
in your Google account. The password is stored there as a salted hash, never in the website.

1. Open <https://script.google.com> → **New project**. Name it `Heights Design login`.
2. Delete the sample code, paste the whole of `admin/apps-script/Code.gs`, click **Save**.
3. **Deploy → New deployment** → gear icon → **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   → **Deploy** → allow the permissions (Advanced → Go to project → Allow).
4. Copy the **Web app URL** (ends in `/exec`).
5. Either send it to Claude, or edit `config.js` in the repo root and paste it between the quotes:
   `window.HC_AUTH_URL = 'https://script.google.com/macros/s/…/exec';`

First login: **fady / fady1234**. Change it straight away with **Change login** on the home page.

Locked out? In the Apps Script editor choose the function `resetCredentials` → **Run**. That resets to fady / fady1234.

Updating the script later: paste the new code → **Deploy → Manage deployments → Edit → Version: New version → Deploy**.
The URL stays the same.
