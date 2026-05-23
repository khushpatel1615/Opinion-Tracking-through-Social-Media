# OpinionTrack

A full-stack local Social Media Public Opinion Tracking web application.

OpinionTrack runs fully on localhost with free local data sources:

- CSV and JSON uploads
- bundled demo social posts
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

## Database

The setup script creates the `opiniontrack` database, tables, seeded users, demo topics, posts, alerts, settings, and security logs.

If your XAMPP MySQL password is different, update `server/.env`.
