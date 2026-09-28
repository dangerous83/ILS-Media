# ILS Media Vault

Password-protected video storage platform for ILS. Built with Next.js, deployed on **Vercel**, storing videos in **Cloudflare R2** and/or **Vercel Blob**.

- Branded login screen (ILS icon) — password set by `ACCESS_PASSWORD` (default `ILS@2026`)
- Drag-and-drop uploads straight from the browser to storage (no server size limits)
  - R2: files over 64 MB upload as parallel multipart chunks
  - Blob: Vercel client uploads with multipart
- Library with hover previews, player, search, filter by storage, sort, copy link, download, delete
- Signed session cookie (12 h), all pages and APIs protected by middleware

## 1. Deploy on Vercel

1. Vercel → **Add New → Project** → import `dangerous83/ILS-Media`. Framework is detected as Next.js.
2. **Settings → Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `ACCESS_PASSWORD` | `ILS@2026` |
   | `SESSION_SECRET` | a long random string (`openssl rand -hex 32`) |
   | `DEFAULT_STORAGE` | `r2` or `blob` |

## 2. Connect Vercel Blob

Vercel project → **Storage → Create Database → Blob** → create a store and **Connect** it to the project.
This adds `BLOB_READ_WRITE_TOKEN` automatically. Redeploy.

## 3. Connect Cloudflare R2 bucket

1. Cloudflare dashboard → **R2 → Create bucket** (e.g. `ils-media`).
2. **R2 → Manage R2 API Tokens → Create API token** with *Object Read & Write* on that bucket.
3. Add to Vercel env vars:

   | Name | Value |
   |---|---|
   | `R2_ACCOUNT_ID` | Cloudflare account ID |
   | `R2_ACCESS_KEY_ID` | token Access Key ID |
   | `R2_SECRET_ACCESS_KEY` | token Secret Access Key |
   | `R2_BUCKET` | `ils-media` |
   | `R2_PUBLIC_URL` | *(optional)* public r2.dev / custom domain URL. Leave empty to keep the bucket private and use signed URLs |

4. **Bucket → Settings → CORS policy** — browsers upload directly to R2, so allow your domain:

   ```json
   [
     {
       "AllowedOrigins": ["https://YOUR-APP.vercel.app", "http://localhost:3000"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Or apply it from the terminal: `node --env-file=.env.local scripts/r2-cors.mjs https://YOUR-APP.vercel.app`

5. Redeploy. The header chips show a green dot for each connected storage.

## Local development

```bash
cp .env.example .env.local   # fill in values
npm install
npm run dev
```

`npm run assets` regenerates the web logos in `public/` from the originals in `assets/`.
