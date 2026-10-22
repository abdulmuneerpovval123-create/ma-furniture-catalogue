# M A FURNITURE – Online Catalogue with Admin

A fast product catalogue for GitHub Pages, with a password-protected admin at `/admin/` where you add, edit and delete products, categories and sub-types without touching code.

## What's in this folder

```
index.html            The catalogue customers see
admin/index.html      Your admin panel  →  your-site/admin/
assets/style.css      Shared look (walnut, parchment, brass)
assets/app.js         Catalogue logic: filters, enquiry list, WhatsApp messages
assets/admin.js       Admin logic: login, products, categories, settings, QR codes
assets/qr.js          QR code maker (no outside service)
data/catalog.json     All products, categories, sub-types and shop settings
images/               Product photos (the admin adds new ones here)
.nojekyll             Tells GitHub Pages to publish the files as they are
```

The admin creates two more files the first time you use it. Both are encrypted with your admin password:

- `config/admin.enc.json`: your GitHub access token.
- `data/private.enc.json`: costs, vendors and hidden prices.

---

## Step 1 – Put the site on GitHub

1. Open your repository on github.com. If it still has the old single-file `index.html`, that's fine: the new one replaces it.
2. Click **Add file → Upload files**.
3. Unzip this package on your computer. Then drag **everything inside the `ma-furniture-site` folder** into the upload box, including the `admin`, `assets`, `data` and `images` folders.
   *Don't open or paste files into GitHub's editor, and don't upload the zip itself.*
4. Click **Commit changes**.
5. Go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, and click **Save**.
6. After a minute or two your catalogue is live at `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`.

> On a free GitHub plan, Pages works only for **public** repositories. That's fine here: the token and private costs are encrypted, and the product data is meant to be public anyway.

## Step 2 – Create a GitHub access token (one time)

The admin uses this token to save your changes to the repository. It can only touch this one repository.

1. On GitHub, click your profile photo → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. **Token name:** `MA catalogue admin`.
3. **Expiration:** choose the longest option offered. Write down the date; you'll replace the token before then (see "Token expired" below).
4. **Repository access:** choose **Only select repositories** and pick your catalogue repository.
5. **Permissions → Repository permissions → Contents:** choose **Read and write**. Leave everything else as it is.
6. Click **Generate token** and copy it (it starts with `github_pat_`). GitHub shows it only once.

## Step 3 – Set up the admin (one time)

1. Open `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/admin/`.
2. Check the GitHub username, repository name and branch (`main`); they're usually filled in already. Paste the token.
3. Choose an **admin password** of at least 12 characters, for example three or four unrelated words. Save it in your phone's password manager.
4. Click **Connect and save**.

From now on, on any phone or computer, go to `/admin/` and enter just your password.

---

## Using the admin

**Products**
- **Add product:** choose the category and sub-type (e.g. *Bedroom Sets → 4 Door*), fill in the name, description and specifications, add customer options (e.g. *Fabric: Velvet, Suede*), and add photos. Then click **Publish product**.
- **Photos:** resized automatically. Tap **Make main** to choose the photo shown on the card.
- **Price:** optional. Tick **Show price to customers** to show it on a brass swing tag. If it isn't ticked, the price is stored encrypted and customers never receive it.
- **Private details:** making cost, lowest price, vendor and notes are encrypted and visible only in the admin.
- **Show this product on the site:** untick to hide a product without deleting it.
- **Delete product:** click it twice to confirm. Its photos are removed too.

**Categories**
- Each category becomes a section on the site, and its sub-types become the filter buttons (*All · 2 Door · 3 Door · 4 Door · 5 Door*).
- Add, rename and reorder categories, and add or remove sub-types.
- A category or sub-type that still has products can't be deleted. Move or delete those products first.

**Settings**
- Shop name, subtitle, WhatsApp number, phone, address, hours, the opening section and its photos.
- **Most designs in one enquiry:** the limit on the customer's enquiry list (1–10).
- **Change admin password** and **Replace GitHub token**.

**QR codes**
- Printable cards for the whole catalogue, each category and (optionally) each sub-type, e.g. scanning *Bedroom Sets · 4 Door* opens that filter directly.

Changes appear on the live site about **1 minute** after saving (GitHub Pages rebuilds). If you don't see them, refresh the page.

## What customers get

- **Filters:** a sub-type filter bar in every category.
- **Product details:** gallery, specifications and option pickers (fabric, finish, bed size…).
- **Enquiry list (bag icon):** collect several designs and send one WhatsApp message to **+91 62352 90961**. Each item in the message lists:
  - code, name, category and sub-type
  - material, size and specifications
  - chosen options and the price, if shown
  - a **direct photo link** and a link that opens that exact product.
- **Single enquiry:** the **Enquire** button sends one product the same way.
- **Links:**
  - `…/#living-room` opens a section.
  - `…/#bedroom-sets/4-door` opens a filtered section.
  - `…/#MAF-LR-01` opens a product.

## If something goes wrong

| Problem | Fix |
|---|---|
| Blank page | Make sure `index.html`, `assets/` and `data/` sit at the top level of the repository, and Pages is set to `main` / root. |
| "GitHub refused the token" | The token expired or was deleted. Create a new one (Step 2), then in the admin go to **Settings → Replace GitHub token**. If you can't sign in at all, see the next row. |
| Forgot the admin password | In GitHub, delete `config/admin.enc.json`, then open `/admin/` and set up again with a token. Private costs saved under the old password can't be opened; re-enter them. |
| Change not showing | Wait a minute and refresh. Check the repository's **Actions** tab: the Pages build should be green. |
| Using your own domain | Add it under Settings → Pages, then put the full address in the admin under **Settings → Public site address**. QR codes and WhatsApp links then use it. |

## How it's protected

- The admin page is public, but saving needs the GitHub token, and GitHub itself enforces that.
- The token is stored only in encrypted form: PBKDF2-SHA256 with 600,000 rounds, then AES-256-GCM. Your password is the key.
- Costs, vendors and hidden prices are encrypted the same way.
- Your password and the token stay only in the open browser tab. They're cleared when you click **Lock**, close the tab, or after 30 minutes without activity.
- A strong password matters: anyone can download the encrypted files and try to guess it, so use 12+ characters that aren't easy to guess.
