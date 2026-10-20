# CNA Fund Monitor

A web tool for the Provincial Budget Office. It reads the e-budget report, keeps only the accounts that fund the Collective Negotiation Agreement (CNA) incentive, and shows how much is available and whether it covers the amount to be paid to employees.

## What it shows

**Dashboard** (the first screen after sign-in): the available fund in both bases (appropriation balance at the 20% retention, and overall available balance = appropriation + allotment, with the allotment balance highlighted), the funding requirement (employees x amount per employee) and whether each balance covers it, and the voided fund sources.

**Reports**: nothing is shown until you choose. Pick the report, then the fund and office where asked. **Print this report** and **Download Excel** apply only to the report on screen.

- **Summary report** (choose the fund: appropriation balance 20%, or overall): available fund per office before voided fund sources, then the voided fund sources, then the net available fund for CNA, then the funding requirement.
- **Per office report** (choose the fund and one office, or all offices): the office's fund sources before voided, the voided fund sources, and the net available fund. "All offices" gives every office this way (fund sources with no balance are not listed), then the province total, the voided fund sources and the funding requirement at the bottom. The funding requirement is not shown for a single office.
- **Per fund source report**: available fund per fund source, province-wide.
- **Voided funds report**: the voided fund sources and the voided amount per office.

In detail:

- A fund source is voided in every office; the office and reason you type are remarks. Voided amounts are shown in red and deducted from the totals.
- Heading: *Fund Sources of the CNA Incentive (year)* and *As of (date of the e-budget report)*.
- **Print** and **Download Excel** (the workbook uses formulas, so every total can be checked).
- **History** of every upload and every change; any version can be opened.

## Two kinds of accounts

- **Administrator**: uploads the Excel file, sets the year, number of employees and amount per employee, voids fund sources, manages accounts.
- **Head of Office**: view, print and download only.

## Start it (Windows)

1. Install **Node.js (LTS)** from https://nodejs.org on the server computer (once).
2. Double-click **start.bat**. The first run installs what the app needs (internet required, once).
3. The window shows the first sign-in: user `admin` and a temporary password. It is also saved in `data/FIRST_LOGIN_PASSWORD.txt` until you choose your own password.
4. Open the address shown as `On this computer`. Give the head of office the address shown as `On the office network`, for example `http://192.168.1.20:3000`.
5. If Windows asks whether to allow Node.js on the network, allow it on **Private networks**.

Keep the window open while people use the report. On Mac or Linux, run `./start.sh`.

## Make the link reliable

- Set the computer to **never sleep** and give it a **fixed IP address** (ask your IT staff), so the link does not change.
- A UPS is worth having.
- To start the app automatically when the computer turns on, put a shortcut to `start.bat` in the Windows Startup folder (`Win + R`, type `shell:startup`).

## Install it on a phone's home screen

Open the app's address in the phone's browser and sign in once.
- **iPhone (Safari):** tap the Share button, then **Add to Home Screen**, then **Add**.
- **Android (Chrome):** tap the menu (three dots), then **Install app** or **Add to Home screen**.

It then opens full screen from an icon with the provincial seal. The app screens are kept on the phone so it opens quickly. If the server is off or asleep, the phone shows the last report it received, marked as a saved copy with its "as of" date. Signing out removes that saved report from the phone. Figures always come from the server; this is not a separate app store app.

## Open it from outside the office (Tailscale, free)

Tailscale makes a private network between the server computer and the phones of the people you approve. Nobody else can reach the app.

On the server computer:
1. Install Tailscale from https://tailscale.com/download and sign in (a free personal account).
2. Note the computer's Tailscale address (starts with `100.`) shown in the Tailscale window.
3. Keep the CNA Fund Monitor window open and the computer awake.

On each phone (iPhone or Android):
1. Install **Tailscale** from the App Store or Play Store.
2. Sign in with the same account, or accept an invitation: in the Tailscale admin page, use **Share** on the server computer, or invite the person as a user.
3. Switch Tailscale on, then open the browser and go to `http://100.x.x.x:3000` (the address from step 2, and your port).

The phone must have Tailscale switched on whenever it opens the report. Sign-in to the app is still required.

## Put it online with Render and Neon (no office computer needed)

The same app can run online. The code lives on GitHub, **Render** runs it, and **Neon** (a free Postgres database) keeps the data, so nothing is lost when Render restarts or sleeps. Please make sure your office allows the figures and sign-in accounts to be kept on these services.

**1. Neon (the database)**
1. Sign up at https://neon.com and create a project (any name; choose the region nearest you, for example Singapore).
2. Open the project's **Connect** button and copy the connection string. It looks like `postgresql://user:password@host/dbname?sslmode=require`. Keep it private.

**2. GitHub (the code)**
1. Create a **private** repository on GitHub.
2. Upload the contents of this folder to it (the `.gitignore` keeps `node_modules` and `data` out). Do not put the Neon connection string or any password in the repository.

**3. Render (the server)**
1. Sign up at https://render.com and choose **New > Web Service**, then connect the GitHub repository. (Or **New > Blueprint**, which reads `render.yaml`.)
2. Settings: Runtime **Node**, Build command `npm install --omit=dev`, Start command `node server.js`, Instance type **Free**, Health check path `/healthz`.
3. Environment variables:
   - `DATABASE_URL`: the Neon connection string.
   - `ADMIN_PASSWORD`: a first password for the `admin` account (at least 8 characters). You must change it at first sign-in.
   - `SESSION_SECRET`: any long random text (at least 16 characters).
   - `NODE_VERSION`: `22`
4. Deploy. When it says live, open the address Render shows (`https://something.onrender.com`) and sign in as `admin`.

**4. Keep it awake (optional)**
On the free plan Render puts the app to sleep after 15 minutes without visits, and the next visit takes about a minute. To avoid this, add a free monitor at https://uptimerobot.com: create an **HTTP(s)** monitor for `https://your-address.onrender.com/healthz` with a 5-minute interval. Render's free plan includes enough hours for one service to stay awake all month, but it may change the rules, and it can still restart the app at any time (no data is lost).

**Moving your existing data from the office computer to the online version**

1. On the office computer, replace the app files with this version (unzip over the folder, keep the `data` folder), then double-click **export-backup.bat** (or run `node export-backup.js`). It writes `CNA_backup_<date>.json` with your history, uploaded reports, voided fund sources and accounts. The app does not need to be running.
2. Sign in to the online app, open **Upload and figures**, choose that file under **Restore from a backup file** and click **Restore**.
3. Sign in again with the account and password you used on the office computer.

Keep that file private: it contains the sign-in accounts.

**5. Backups**
The database keeps only a few hours of its own history, so use **Upload and figures > Download backup** after each change that matters and keep the file somewhere private (it contains the sign-in accounts). **Restore** puts a backup back. **Saved copy** in the top bar downloads a page that opens without the server.

In this mode the app does not use the saved-copy folder, the backup folder or `settings.json`. When you run it on an office computer without `DATABASE_URL`, it works as described above.

## Upload a new e-budget report

1. Sign in as `admin`, open **Upload and figures**.
2. Drop in the e-budget report **exactly as the system exports it** (`.xls` or `.xlsx`). No editing is needed.
3. The app reads the report date from the "As of" line, keeps only the CNA fund sources, and works out every total from the account lines. It also compares them with the report's Grand Total when that cell is filled in (some exports leave the Sub Total and Grand Total cells at zero; the app then says it could not compare, and the figures are still correct).

The list of CNA fund sources (33 accounts) comes with the app and is remembered from one upload to the next. To change the list, upload a workbook that also has a sheet named **CNA Fund Source** with one account name per row; that list then replaces the old one. Accounts in the report that are not on the list are ignored, and if a name on the list is not found in the report, the upload page says so.

## When the server is off

Each time anything changes, the app saves two files into the **saved copy folder** (`data/latest-report` unless you change it):

- `CNA_Fund_Sources_latest.html` opens in any browser with no server, no sign-in and no internet. It has the same Dashboard and Reports pages with the latest data and the "as of" date, Print, and a link to the full Excel workbook.
- `CNA_Fund_Sources_latest.xlsx` is the same report as a workbook.

To let the head of office open it when the server is down, point the saved copy folder to a shared network folder. Edit `settings.json`:

```json
{ "port": 3000, "snapshotDir": "\\\\OFFICE-PC\\Shared\\CNA", "backupDir": "D:\\CNA-backups", "dataDir": "" }
```

The saved copy has no sign-in, so share that folder only with the people who may see the figures.

A browser that has already opened the report also keeps the last report it received and shows it, marked as a saved copy, if the server stops while the page is open. A server that is completely off cannot send the page itself, which is why the saved copy folder exists.

## Backups

A backup of the whole `data` folder is made automatically once a day (the last 30 are kept) in `data/backups`, and the **Back up now** button on the Upload and figures page makes one on demand. Set `backupDir` in `settings.json` to keep backups on another drive. To restore, stop the app and copy a backup folder's contents back into `data`.

## Security notes

- Passwords are stored as hashes. Five wrong attempts lock that user for 15 minutes. Sessions last 10 hours.
- The link is plain `http` on your office network, so traffic is not encrypted. Use it on a trusted network only. For access from outside the office, put it behind HTTPS or a VPN arranged with your IT staff.
- The `data` folder holds the financial data and the password hashes. Do not share it.

## Moving it to a hosted server later

Copy this folder to any server that runs Node.js 18 or newer, run `npm install --omit=dev`, and start it with `node server.js`. Set the port and folders with `settings.json` or the `PORT`, `DATA_DIR`, `SNAPSHOT_DIR` and `BACKUP_DIR` environment variables. Copy the `data` folder across to keep the history and accounts.

## Files

`server.js` (the server), `lib/` (reading the workbook, calculations, Excel export, saved copy), `public/` (the pages), `data/` (created on first run).
