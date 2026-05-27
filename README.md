# OpinionTrack

A full-stack local Social Media Public Opinion Tracking web application.

OpinionTrack runs fully on localhost with free local data sources:

- CSV and JSON uploads
- bundled demo social posts
- free live source presets for Bluesky, Mastodon, and RSS
- local sentiment analysis
- local rule-based summaries
- MySQL via XAMPP

No paid social media APIs are required.

## Tech Stack

- Frontend: React, Vite, Tailwind CSS
- Backend: Node.js, Express.js
- Database: MySQL using XAMPP
- Charts: Recharts
- Icons: Lucide React
- Animation: Framer Motion
- Reports: PDFKit and ExcelJS
- Uploads: Multer and csv-parser
- Auth: JWT and bcrypt
- Live updates: background source workers and Server-Sent Events

## Free Live Sources

The app includes a `Live Sources` page for near-real-time collection:

- Bluesky: Jetstream WebSocket, filtered by topic keywords
- Mastodon: public hashtag stream from a configured instance
- RSS: polling feed URLs every 1-5 minutes

Reddit and YouTube should stay optional because their official APIs need OAuth/API keys and have free quota limits. The core demo does not depend on them.

## Quick Start

Install Node.js and start MySQL in XAMPP first.

```bash
cp server/.env.example server/.env
npm run install:all
npm run db:setup
npm run server
```

Open a second terminal:

```bash
npm run client
```

You can also run each app directly:

```bash
cd server
cp .env.example .env
npm install
npm run db:setup
npm run dev
```

Open a second terminal:

```bash
cd client
npm install
npm run dev
```

Default accounts:

- Admin: `admin@opiniontrack.local` / `Admin@12345`
- User: `user@opiniontrack.local` / `User@12345`

## Demo Flow

1. Log in as the demo user.
2. Open `Setup` and confirm API, database, and source presets are ready.
3. Open `Live Sources`.
4. Start the RSS preset first for the most reliable free demo.
5. Watch the dashboard, monitoring table, sentiment charts, alerts, and reports update.
6. Generate a PDF or Excel report from `Reports`.

## Database

The setup script creates the `opiniontrack` database, tables, seeded users, demo topics, posts, source presets, alerts, settings, and security logs. It also updates existing local databases with the live-source schema.

If your XAMPP MySQL password is different, update `server/.env`.
