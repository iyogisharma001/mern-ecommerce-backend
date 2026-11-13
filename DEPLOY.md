# Deploying the store (Render + Vercel)

- **Backend** (this repo) → **Render**, free web service plus free Redis, from `render.yaml`
- **Frontend** ([mern-ecommerce-frontend](https://github.com/iyogisharma001/mern-ecommerce-frontend)) → **Vercel**
- Also needed: **MongoDB Atlas**, **Cloudinary**, **Firebase**, **Stripe**. All have free tiers. Redis needs no account; Render creates it.

Do the steps in order: later steps need URLs from earlier ones.
Collect every value in a private note as you go. **Never commit keys to git.**

---

## 1. Collect the service keys

### MongoDB Atlas → `MONGO_URI`
1. https://cloud.mongodb.com → create a free **M0** cluster.
2. **Database Access** → add a database user with a password.
3. **Network Access** → add `0.0.0.0/0`. Render's free plan has no fixed IP address, so Atlas has to accept any IP. The password still protects the database.
4. **Connect → Drivers** → copy the `mongodb+srv://...` string and put your password in it.
   The app uses the database `Ecommerce_24` automatically.

### Cloudinary → `CLOUD_NAME`, `CLOUD_API_KEY`, `CLOUD_API_SECRET`
Dashboard → **Product Environment / API Keys**.

### Firebase (Google login)
1. https://console.firebase.google.com → create a project.
2. **Authentication → Sign-in method** → enable **Google**.
3. **Project settings → General → Your apps** → add a **Web** app. Its config gives the frontend values:
   `apiKey`→`VITE_FIREBASE_KEY`, `authDomain`→`VITE_AUTH_DOMAIN`, `projectId`→`VITE_PROJECT_ID`,
   `storageBucket`→`VITE_STORAGE_BUCKET`, `messagingSenderId`→`VITE_MESSAGING_SENDER_ID`, `appId`→`VITE_APP_ID`.
4. **Project settings → Service accounts → Generate new private key** downloads a JSON file. It gives the backend values:
   `project_id`→`FIREBASE_PROJECT_ID`, `client_email`→`FIREBASE_CLIENT_EMAIL`, `private_key`→`FIREBASE_PRIVATE_KEY`.
   Paste the private key exactly as it appears in the JSON, with the `\n` characters. Keep this file secret.

### Stripe → `STRIPE_KEY` (backend), `VITE_STRIPE_KEY` (frontend)
Stay in **Test mode**. **Developers → API keys**:
- **Secret key** `sk_test_...` → backend `STRIPE_KEY`
- **Publishable key** `pk_test_...` → frontend `VITE_STRIPE_KEY`

---

## 2. Backend on Render
1. https://render.com → sign up with GitHub and allow access to `mern-ecommerce-backend`.
2. **New → Blueprint** → choose the repo. Render reads `render.yaml`, which sets up:
   - `mern-ecommerce-backend`, a Docker web service in Singapore on the free plan
   - `mern-ecommerce-redis`, a free Key Value (Redis) instance whose `REDIS_URI` is filled in automatically
3. Render asks for the secret values. Fill them in from step 1. For now:
   - `CLIENT_URL` → `http://localhost:5173` (you replace it in step 4)
   - `STRIPE_WEBHOOK_SECRET` → `placeholder` (you replace it in step 5)
4. **Apply** and wait for the deploy. Open the service URL, e.g. `https://mern-ecommerce-backend-xxxx.onrender.com`.
   It should show **`API Working with /api/v1`**. Copy this URL.

## 3. Frontend on Vercel
1. https://vercel.com → sign up with GitHub → **Add New → Project** → import `mern-ecommerce-frontend`.
2. Vercel detects Vite. Leave the build settings as they are.
3. **Environment Variables**: add all of these:
   | Key | Value |
   |---|---|
   | `VITE_SERVER` | the Render URL from step 2, **no trailing slash** |
   | `VITE_STRIPE_KEY` | `pk_test_...` |
   | `VITE_FIREBASE_KEY`, `VITE_AUTH_DOMAIN`, `VITE_PROJECT_ID`, `VITE_STORAGE_BUCKET`, `VITE_MESSAGING_SENDER_ID`, `VITE_APP_ID` | from the Firebase web config |
4. **Deploy**. Copy the site URL, e.g. `https://mern-ecommerce-frontend.vercel.app`.
   `vercel.json` sends every path to the React app, so refreshing `/cart` or `/admin/...` works.

## 4. Connect the two
1. **Render** → backend service → **Environment** → set `CLIENT_URL` to the Vercel URL, with no trailing slash.
   To allow several URLs, separate them with commas.
   Save; the service redeploys.
2. **Firebase** → Authentication → **Settings → Authorized domains** → add your `xxxx.vercel.app` domain.
   Without this, Google login fails on the live site.

## 5. Stripe webhook
The webhook creates the order even if the customer closes the tab right after paying.
1. Stripe (Test mode) → **Developers → Webhooks → Add endpoint**
   - URL: `https://<your-render-url>/api/v1/payment/webhook`
   - Event: `payment_intent.succeeded`
2. Copy the **Signing secret** `whsec_...` → Render → set `STRIPE_WEBHOOK_SECRET` → Save.

## 6. Make yourself admin
1. Log in once on the live site with Google.
2. Atlas → **Browse Collections** → `Ecommerce_24` → `users` → your document → set `role` to `"admin"`.
3. Refresh the site. **Admin** now appears in the user menu.

## 7. Test it
1. As admin, add a product with a photo. This checks Cloudinary.
2. As a customer, add it to the cart → Checkout → country **India** → pay with test card
   `4242 4242 4242 4242`, any future date, any CVC.
3. The order appears in **Orders**, and the product's stock goes down.

---

## Good to know
- **Free Render sleeps** after 15 minutes without traffic. The first request after that takes about a minute.
  Free Render also has 750 instance hours a month per account.
- **Free Redis is only a cache.** It is emptied when it restarts, which is harmless here.
- **Going live with real payments:** switch Stripe to Live mode and replace `STRIPE_KEY`, `VITE_STRIPE_KEY` and the webhook secret with the live ones. After changing any `VITE_` variable, redeploy on Vercel, because those values are built into the site.
- **Pushes to `main` redeploy automatically** on both Render and Vercel.
