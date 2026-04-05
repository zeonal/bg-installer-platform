# BG Installer Platform — MVP

A web platform for Brighten Generation's certified solar installers. Built with Node.js, Express, SQLite, and vanilla HTML/CSS/JS.

---

## Demo Accounts

| Role      | Username    | Password       | Tier     |
|-----------|-------------|----------------|----------|
| Admin     | `admin`     | `admin123`     | —        |
| Installer | `somchai`   | `installer123` | Standard |
| Installer | `nattapong` | `installer123` | Expert   |
| Installer | `wiroj`     | `installer123` | Master   |

---

## Local Development

### Prerequisites
- Node.js 18 or higher
- npm

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start

# 3. Open in browser
# http://localhost:3000
```

For development with auto-restart on file changes:
```bash
npm run dev
```

The SQLite database (`database.db`) is created automatically on first run and seeded with demo data.

---

## Deploy to Railway (Recommended)

Railway is the recommended hosting platform. It supports Node.js natively, deploys directly from GitHub, and costs approximately $5/month for a small production app.

### Step-by-step:

1. **Push your code to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit: BG Installer Platform MVP"
   git remote add origin https://github.com/YOUR_USERNAME/bg-installer-platform.git
   git push -u origin main
   ```

2. **Create a Railway account** at [railway.app](https://railway.app) (sign in with GitHub)

3. **Create a new project** → "Deploy from GitHub repo" → Select your repository

4. **Set environment variables** in Railway dashboard:
   - `JWT_SECRET` → Set a strong, random string (e.g. generate one at [randomkeygen.com](https://randomkeygen.com))
   - `PORT` → Railway sets this automatically, no action needed

5. **Deploy** — Railway will automatically detect Node.js, run `npm install`, and start with `npm start`

6. **Access your app** at the Railway-provided URL (e.g. `https://bg-installer-platform.up.railway.app`)

> **Note:** Railway's free tier uses ephemeral storage, which means the SQLite database resets on each deployment. For a persistent production database, add a Railway PostgreSQL plugin and update `server.js` to use it. Contact your developer to migrate when you're ready.

---

## Project Structure

```
├── package.json          # Dependencies and start script
├── server.js             # Express backend + SQLite + JWT auth
├── database.db           # Auto-created SQLite database (gitignored)
├── .gitignore
└── public/               # Frontend (static files served by Express)
    ├── style.css         # Shared design system
    ├── index.html        # Login page
    ├── dashboard.html    # Installer dashboard
    ├── roi.html          # ROI Calculator
    ├── boq.html          # BOQ Builder
    └── faq.html          # Technical FAQ
```

---

## Features

- **Secure login** with JWT authentication (8-hour sessions)
- **Installer dashboard** with BG Certified Installer tier, progress bar, scenario completion, and stats
- **ROI Calculator** with Thai electricity rates, battery toggle, CO₂ offset, and PDF export
- **BOQ Builder** with full Sigenergy product catalog organized by category, live summary, and PDF export
- **Technical FAQ** with 4 categories (20 Q&As), real-time search, and expandable answers

---

## Tier System

| Tier     | Requirements                                                   |
|----------|----------------------------------------------------------------|
| Standard | 0 – 9 sites commissioned                                       |
| Advanced | 10 – 29 sites + 5 backup/off-grid projects                     |
| Expert   | 30 – 49 sites + all residential scenarios completed            |
| Master   | 50+ sites + residential and C&I scale experience              |

Tier is calculated automatically from the installer's profile data. All tracking is lifetime (cumulative).

---

## Environment Variables

| Variable     | Required | Description                          |
|--------------|----------|--------------------------------------|
| `PORT`       | No       | Server port (default: 3000)          |
| `JWT_SECRET` | Yes (prod) | Secret key for JWT signing. Set a strong random value in production. |

---

## Built With

- [Express](https://expressjs.com/) — Node.js web framework
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — Fast, synchronous SQLite
- [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) — JWT authentication
- [bcryptjs](https://github.com/dcodeIO/bcrypt.js) — Password hashing
- [Font Awesome](https://fontawesome.com/) — Icons
- [Inter](https://rsms.me/inter/) — Typography

---

*Brighten Generation · Authorized Sigenergy Distributor · Thailand*
