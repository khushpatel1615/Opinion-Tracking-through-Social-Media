import cors from "cors";
import csv from "csv-parser";
import dotenv from "dotenv";
import ExcelJS from "exceljs";
import express from "express";
import fs from "fs";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import multer from "multer";
import path from "path";
import PDFDocument from "pdfkit";
import { fileURLToPath } from "url";
import { pool, query } from "./db.js";
import { analyzeSentiment, extractKeywords } from "./utils/sentiment.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const uploadDir = path.join(rootDir, "uploads");
const reportDir = path.join(rootDir, "reports");
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(reportDir, { recursive: true });

const app = express();
const upload = multer({ dest: uploadDir });
const PORT = Number(process.env.PORT || 5000);
const JWT_SECRET = process.env.JWT_SECRET || "local-opiniontrack-secret";
const liveClients = new Map();
const sourceWorkers = new Map();
let sourceReloadTimer = null;

app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json({ limit: "5mb" }));

function wrapAsync(fn) {
  return function wrappedRoute(req, res, next) {
    return Promise.resolve(fn(req, res, next)).catch(next);
  };
}

for (const method of ["get", "post", "put", "delete", "patch"]) {
  const original = app[method].bind(app);
  app[method] = (...args) => original(...args.map((arg) => (typeof arg === "function" ? wrapAsync(arg) : arg)));
}

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
}

async function userFromToken(token) {
  const decoded = jwt.verify(token, JWT_SECRET);
  const rows = await query("SELECT id,name,email,role,status,created_at FROM users WHERE id = ?", [decoded.id]);
  if (!rows.length || rows[0].status !== "active") return null;
  return rows[0];
}

async function auth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ message: "Missing token" });
    const user = await userFromToken(token);
    if (!user) return res.status(401).json({ message: "Invalid user" });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ message: "Admin only" });
  next();
}

function scopedUserId(req) {
  return req.user.role === "admin" && req.query.userId ? Number(req.query.userId) : req.user.id;
}

async function logAction(userId, action, ip) {
  await query("INSERT INTO security_logs (user_id, action, ip_address) VALUES (?,?,?)", [userId || null, action, ip || "localhost"]);
}

function csvTerms(value = "") {
  return String(value)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function stripHtml(value = "") {
  return String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeXml(value = "") {
  return String(value)
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function sourceMatchesTopic(source, topic, text) {
  const haystack = String(text || "").toLowerCase();
  const terms = [...csvTerms(source.query), ...csvTerms(topic.keywords), topic.name?.toLowerCase()].filter(Boolean);
  return terms.length === 0 || terms.some((term) => haystack.includes(term.replace(/^#/, "")));
}

function sendLiveEvent(userId, payload) {
  const clients = liveClients.get(Number(userId)) || [];
  const data = `data: ${JSON.stringify({ at: new Date().toISOString(), ...payload })}\n\n`;
  clients.forEach((res) => res.write(data));
}

async function findTopicForSource(source, content) {
  if (source.topic_id) {
    const rows = await query("SELECT * FROM topics WHERE id=? AND user_id=?", [source.topic_id, source.user_id]);
    if (rows.length) return rows[0];
  }
  const topics = await query("SELECT * FROM topics WHERE user_id=?", [source.user_id]);
  return topics.find((topic) => sourceMatchesTopic(source, topic, content)) || topics[0] || null;
}

async function ensureTopic(userId, name, type = "keyword") {
  const topicName = name || "General";
  const existing = await query("SELECT * FROM topics WHERE user_id = ? AND name = ?", [userId, topicName]);
  if (existing.length) return existing[0];
  const colors = ["#0ea5e9", "#22c55e", "#f97316", "#8b5cf6", "#ef4444"];
  const result = await query("INSERT INTO topics (user_id,name,type,description,color,keywords) VALUES (?,?,?,?,?,?)", [
    userId,
    topicName,
    type,
    "Created from uploaded data",
    colors[Math.floor(Math.random() * colors.length)],
    topicName
  ]);
  return { id: result.insertId, name: topicName, user_id: userId, type };
}

async function insertPost(userId, row) {
  let topic = row.topicId ? (await query("SELECT * FROM topics WHERE id=? AND user_id=?", [row.topicId, userId]))[0] : null;
  if (!topic) topic = await ensureTopic(userId, row.topic || row.topicName || "General", row.type || "keyword");
  const sentiment = analyzeSentiment(row.content || "");
  const result = await query(
    `INSERT IGNORE INTO posts
     (topic_id, source_id, external_id, platform, author, content, posted_at, likes, shares, comments, url, source_url, language, fetched_at, sentiment_label, sentiment_score)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      topic.id,
      row.sourceId || null,
      row.externalId || null,
      row.platform || "Local",
      row.author || "anonymous",
      row.content || "",
      row.postedAt ? new Date(row.postedAt) : new Date(),
      Number(row.likes || 0),
      Number(row.shares || 0),
      Number(row.comments || 0),
      row.url || "",
      row.sourceUrl || row.url || "",
      row.language || "unknown",
      row.fetchedAt ? new Date(row.fetchedAt) : new Date(),
      sentiment.label,
      sentiment.score
    ]
  );
  return result.affectedRows > 0;
}

async function postsForUser(userId, topicId = null) {
  const params = [userId];
  let where = "t.user_id = ?";
  if (topicId) {
    where += " AND t.id = ?";
    params.push(topicId);
  }
  return query(
    `SELECT p.*, t.name AS topic_name, t.type AS topic_type, t.color AS topic_color,
    (p.likes + p.shares + p.comments) AS engagement
    FROM posts p JOIN topics t ON p.topic_id = t.id
    WHERE ${where}
    ORDER BY p.posted_at DESC, p.id DESC`,
    params
  );
}

async function analytics(userId, topicId = null) {
  const posts = await postsForUser(userId, topicId);
  const sentiment = { positive: 0, negative: 0, neutral: 0 };
  let engagement = 0;
  posts.forEach((post) => {
    sentiment[post.sentiment_label] += 1;
    engagement += Number(post.engagement || 0);
  });
  const trendsMap = {};
  posts.forEach((post) => {
    const day = new Date(post.posted_at).toISOString().slice(0, 10);
    trendsMap[day] ||= { date: day, mentions: 0, positive: 0, negative: 0, neutral: 0 };
    trendsMap[day].mentions += 1;
    trendsMap[day][post.sentiment_label] += 1;
  });
  const topicMap = {};
  posts.forEach((post) => {
    topicMap[post.topic_name] ||= { name: post.topic_name, mentions: 0, engagement: 0, negative: 0 };
    topicMap[post.topic_name].mentions += 1;
    topicMap[post.topic_name].engagement += Number(post.engagement || 0);
    if (post.sentiment_label === "negative") topicMap[post.topic_name].negative += 1;
  });
  return {
    totalMentions: posts.length,
    engagement,
    sentiment,
    trends: Object.values(trendsMap).sort((a, b) => a.date.localeCompare(b.date)),
    competitors: Object.values(topicMap).sort((a, b) => b.mentions - a.mentions),
    topPosts: posts.sort((a, b) => b.engagement - a.engagement).slice(0, 5),
    keywords: extractKeywords(posts)
  };
}

async function checkAlerts(userId) {
  const alerts = await query("SELECT * FROM alerts WHERE user_id = ? AND enabled = TRUE", [userId]);
  for (const alert of alerts) {
    const data = await analytics(userId, alert.topic_id);
    let triggered = false;
    let severity = "medium";
    let message = "";
    if (alert.condition_type === "negative_threshold") {
      const pct = data.totalMentions ? Math.round((data.sentiment.negative / data.totalMentions) * 100) : 0;
      triggered = pct >= Number(alert.threshold_value);
      severity = pct >= 50 ? "high" : "medium";
      message = `Negative sentiment reached ${pct}% for this topic.`;
    }
    if (alert.condition_type === "mention_spike" || alert.condition_type === "competitor_spike") {
      triggered = data.totalMentions >= Number(alert.threshold_value);
      message = `Mentions reached ${data.totalMentions}.`;
    }
    if (alert.condition_type === "negative_keyword") {
      const posts = await postsForUser(userId, alert.topic_id);
      triggered = posts.some((post) => post.sentiment_label === "negative" && post.content.toLowerCase().includes(String(alert.threshold_value).toLowerCase()));
      message = `Negative keyword "${alert.threshold_value}" appeared in local data.`;
    }
    if (triggered) {
      await query("UPDATE alerts SET last_triggered_at = NOW() WHERE id = ?", [alert.id]);
      await query("INSERT INTO alert_events (alert_id,message,severity) VALUES (?,?,?)", [alert.id, message, severity]);
    }
  }
}

async function setSourceStatus(sourceId, status, error = "") {
  await query("UPDATE sources SET status=?, last_error=?, last_run_at=NOW() WHERE id=?", [status, error, sourceId]);
}

async function recordRun(sourceId, status, imported, skipped, error = "") {
  await query("INSERT INTO collection_runs (source_id,status,imported_count,skipped_count,error_message) VALUES (?,?,?,?,?)", [
    sourceId,
    status,
    imported,
    skipped,
    error
  ]);
}

function rssTags(xml, tag) {
  return [...String(xml).matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map((match) => decodeXml(stripHtml(match[1])));
}

function parseRssItems(xml) {
  const blocks = [...String(xml).matchAll(/<(item|entry)[^>]*>([\s\S]*?)<\/\1>/gi)].map((match) => match[2]);
  return blocks.map((block, index) => {
    const title = rssTags(block, "title")[0] || "";
    const description = rssTags(block, "description")[0] || rssTags(block, "summary")[0] || rssTags(block, "content")[0] || "";
    const link = rssTags(block, "link")[0] || (block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ?? "");
    const date = rssTags(block, "pubDate")[0] || rssTags(block, "updated")[0] || rssTags(block, "published")[0] || new Date().toISOString();
    const guid = rssTags(block, "guid")[0] || rssTags(block, "id")[0] || link || `${title}-${index}`;
    return { title, description, link, date, guid, content: `${title}. ${description}`.trim() };
  });
}

async function importSourceItem(source, item) {
  const topic = await findTopicForSource(source, item.content);
  if (!topic || !sourceMatchesTopic(source, topic, item.content)) return false;
  const inserted = await insertPost(source.user_id, {
    topicId: topic.id,
    sourceId: source.id,
    externalId: item.externalId,
    platform: item.platform,
    author: item.author,
    content: item.content,
    postedAt: item.postedAt,
    url: item.url,
    sourceUrl: item.sourceUrl || item.url,
    language: item.language,
    likes: item.likes,
    shares: item.shares,
    comments: item.comments
  });
  if (inserted) {
    await query("UPDATE sources SET last_imported_at=NOW(), status='live', last_error='' WHERE id=?", [source.id]);
    await checkAlerts(source.user_id);
    sendLiveEvent(source.user_id, { type: "post_imported", sourceId: source.id, sourceName: source.name, platform: item.platform });
  }
  return inserted;
}

async function collectRss(source, testOnly = false) {
  const response = await fetch(source.url, { headers: { "User-Agent": "OpinionTrack/1.0 local demo" } });
  if (!response.ok) throw new Error(`RSS request failed with ${response.status}`);
  const xml = await response.text();
  const items = parseRssItems(xml).slice(0, testOnly ? 5 : 25);
  let imported = 0;
  let skipped = 0;
  for (const item of items) {
    if (!item.content) {
      skipped += 1;
      continue;
    }
    if (testOnly) {
      imported += 1;
      continue;
    }
    const ok = await importSourceItem(source, {
      externalId: item.guid,
      platform: "RSS",
      author: new URL(source.url).hostname,
      content: item.content,
      postedAt: item.date,
      url: item.link,
      sourceUrl: item.link,
      language: "unknown"
    });
    ok ? (imported += 1) : (skipped += 1);
  }
  return { imported, skipped, sampleCount: items.length };
}

async function testStreamingSource(source) {
  if (source.type === "mastodon") {
    const base = String(source.url || "https://mastodon.social").replace(/\/$/, "");
    const response = await fetch(`${base}/api/v1/streaming/health`);
    if (!response.ok) throw new Error(`Mastodon streaming health returned ${response.status}`);
    return { ok: true, message: "Mastodon streaming endpoint is reachable." };
  }
  if (source.type === "bluesky") {
    if (typeof WebSocket !== "function") return { ok: true, message: "Bluesky worker will use WebSocket when available in Node." };
    await new Promise((resolve, reject) => {
      const url = source.url || "wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post";
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("Bluesky connection timed out"));
      }, 8000);
      socket.onopen = () => {
        clearTimeout(timer);
        socket.close();
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Bluesky WebSocket connection failed"));
      };
    });
    return { ok: true, message: "Bluesky Jetstream is reachable." };
  }
  return { ok: true, message: "Connector stub is configured but disabled for the free MVP." };
}

async function runSourceOnce(source, testOnly = false) {
  if (source.type === "rss") return collectRss(source, testOnly);
  return testStreamingSource(source);
}

function startRssWorker(source) {
  async function tick() {
    let imported = 0;
    let skipped = 0;
    try {
      await setSourceStatus(source.id, "polling");
      const result = await collectRss(source);
      imported = result.imported;
      skipped = result.skipped;
      await setSourceStatus(source.id, "live");
      await recordRun(source.id, "success", imported, skipped);
    } catch (error) {
      await setSourceStatus(source.id, "error", error.message);
      await recordRun(source.id, "error", imported, skipped, error.message);
    }
  }
  tick();
  const interval = setInterval(tick, Math.max(60, Number(source.poll_interval_seconds || 300)) * 1000);
  sourceWorkers.set(source.id, { stop: () => clearInterval(interval) });
}

function startBlueskyWorker(source) {
  if (typeof WebSocket !== "function") {
    setSourceStatus(source.id, "error", "Node WebSocket is not available.");
    return;
  }
  let stopped = false;
  let reconnectTimer = null;
  let importedThisMinute = 0;
  const resetTimer = setInterval(() => {
    importedThisMinute = 0;
  }, 60000);
  const connect = () => {
    if (stopped) return;
    const url = source.url || "wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post";
    const socket = new WebSocket(url);
    sourceWorkers.set(source.id, {
      stop: () => {
        stopped = true;
        clearInterval(resetTimer);
        clearTimeout(reconnectTimer);
        socket.close();
      }
    });
    socket.onopen = () => setSourceStatus(source.id, "live");
    socket.onmessage = async (event) => {
      if (importedThisMinute >= 20) return;
      try {
        const payload = JSON.parse(event.data);
        const record = payload.commit?.record;
        if (payload.commit?.collection !== "app.bsky.feed.post" || !record?.text) return;
        if (!sourceMatchesTopic(source, { name: "", keywords: source.query }, record.text)) return;
        const ok = await importSourceItem(source, {
          externalId: `${payload.did}:${payload.commit.rkey}`,
          platform: "Bluesky",
          author: payload.did,
          content: record.text,
          postedAt: record.createdAt || new Date(),
          url: `https://bsky.app/profile/${payload.did}/post/${payload.commit.rkey}`,
          language: record.langs?.[0] || "unknown"
        });
        if (ok) {
          importedThisMinute += 1;
          await recordRun(source.id, "success", 1, 0);
        }
      } catch (error) {
        await setSourceStatus(source.id, "error", error.message);
      }
    };
    socket.onerror = () => setSourceStatus(source.id, "error", "Bluesky stream error");
    socket.onclose = () => {
      if (!stopped) reconnectTimer = setTimeout(connect, 15000);
    };
  };
  connect();
}

async function readSse(response, onEvent) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Streaming response is not readable.");
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";
    for (const chunk of chunks) {
      const dataLine = chunk.split("\n").find((line) => line.startsWith("data:"));
      if (dataLine) await onEvent(dataLine.replace(/^data:\s*/, ""));
    }
  }
}

function startMastodonWorker(source) {
  let stopped = false;
  let controller = null;
  let reconnectTimer = null;
  let importedThisMinute = 0;
  const resetTimer = setInterval(() => {
    importedThisMinute = 0;
  }, 60000);
  const connect = async () => {
    if (stopped) return;
    try {
      controller = new AbortController();
      const base = String(source.url || "https://mastodon.social").replace(/\/$/, "");
      const tag = encodeURIComponent(String(source.query || "").replace(/^#/, "").split(",")[0] || "opensource");
      const streamUrl = `${base}/api/v1/streaming/hashtag?tag=${tag}`;
      await setSourceStatus(source.id, "live");
      const response = await fetch(streamUrl, { signal: controller.signal });
      if (!response.ok) throw new Error(`Mastodon stream returned ${response.status}`);
      await readSse(response, async (line) => {
        if (importedThisMinute >= 20) return;
        const status = JSON.parse(line);
        const content = stripHtml(status.content || "");
        if (!content || !sourceMatchesTopic(source, { name: "", keywords: source.query }, content)) return;
        const ok = await importSourceItem(source, {
          externalId: status.id,
          platform: "Mastodon",
          author: status.account?.acct || "mastodon",
          content,
          postedAt: status.created_at || new Date(),
          url: status.url,
          language: status.language || "unknown",
          likes: status.favourites_count,
          shares: status.reblogs_count,
          comments: status.replies_count
        });
        if (ok) {
          importedThisMinute += 1;
          await recordRun(source.id, "success", 1, 0);
        }
      });
    } catch (error) {
      if (!stopped) {
        await setSourceStatus(source.id, "error", error.message);
        reconnectTimer = setTimeout(connect, 15000);
      }
    }
  };
  sourceWorkers.set(source.id, {
    stop: () => {
      stopped = true;
      clearInterval(resetTimer);
      clearTimeout(reconnectTimer);
      controller?.abort();
    }
  });
  connect();
}

async function reloadSourceWorkers() {
  const sources = await query("SELECT * FROM sources WHERE enabled = TRUE");
  const active = new Set(sources.map((source) => source.id));
  for (const [id, worker] of sourceWorkers.entries()) {
    if (!active.has(id)) {
      worker.stop();
      sourceWorkers.delete(id);
    }
  }
  for (const source of sources) {
    if (sourceWorkers.has(source.id)) continue;
    if (source.type === "rss") startRssWorker(source);
    if (source.type === "bluesky") startBlueskyWorker(source);
    if (source.type === "mastodon") startMastodonWorker(source);
  }
}

app.get("/api/health", (req, res) => res.json({ ok: true, name: "OpinionTrack API" }));

app.post("/api/auth/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: "Name, email, and password are required" });
  const exists = await query("SELECT id FROM users WHERE email = ?", [email]);
  if (exists.length) return res.status(409).json({ message: "Email already registered" });
  const hash = await bcrypt.hash(password, 10);
  const result = await query("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'user')", [name, email, hash]);
  const user = { id: result.insertId, name, email, role: "user", status: "active" };
  await logAction(user.id, "Registered account", req.ip);
  res.status(201).json({ token: signToken(user), user });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const rows = await query("SELECT * FROM users WHERE email = ?", [email]);
  if (!rows.length) return res.status(401).json({ message: "Invalid credentials" });
  const user = rows[0];
  const ok = await bcrypt.compare(password || "", user.password_hash);
  if (!ok || user.status !== "active") return res.status(401).json({ message: "Invalid credentials" });
  await logAction(user.id, "Logged in", req.ip);
  res.json({ token: signToken(user), user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status } });
});

app.get("/api/auth/me", auth, (req, res) => res.json({ user: req.user }));

app.get("/api/live/events", async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ message: "Missing token" });
  let user = null;
  try {
    user = await userFromToken(token);
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
  if (!user) return res.status(401).json({ message: "Invalid token" });
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.write(`data: ${JSON.stringify({ type: "connected", at: new Date().toISOString() })}\n\n`);
  const list = liveClients.get(user.id) || [];
  list.push(res);
  liveClients.set(user.id, list);
  req.on("close", () => {
    liveClients.set(user.id, (liveClients.get(user.id) || []).filter((client) => client !== res));
  });
});

app.get("/api/setup/status", auth, async (req, res) => {
  const [sourceCount] = await query("SELECT COUNT(*) AS total FROM sources WHERE user_id=?", [scopedUserId(req)]);
  const [liveCount] = await query("SELECT COUNT(*) AS total FROM sources WHERE user_id=? AND enabled=TRUE", [scopedUserId(req)]);
  const [latestRun] = await query(
    `SELECT cr.*, s.name AS source_name FROM collection_runs cr JOIN sources s ON cr.source_id=s.id
     WHERE s.user_id=? ORDER BY cr.created_at DESC LIMIT 1`,
    [scopedUserId(req)]
  );
  res.json({
    api: "running",
    database: "connected",
    sources: sourceCount.total,
    enabledSources: liveCount.total,
    latestRun: latestRun || null,
    workerCount: sourceWorkers.size
  });
});

app.get("/api/topics", auth, async (req, res) => {
  res.json(await query("SELECT * FROM topics WHERE user_id = ? ORDER BY created_at DESC", [scopedUserId(req)]));
});
app.post("/api/topics", auth, async (req, res) => {
  const { name, type, description, color, keywords } = req.body;
  const result = await query("INSERT INTO topics (user_id,name,type,description,color,keywords) VALUES (?,?,?,?,?,?)", [req.user.id, name, type, description || "", color || "#0ea5e9", keywords || name]);
  res.status(201).json({ id: result.insertId, name, type, description, color, keywords: keywords || name });
});
app.get("/api/topics/:id", auth, async (req, res) => {
  const rows = await query("SELECT * FROM topics WHERE id = ? AND user_id = ?", [req.params.id, scopedUserId(req)]);
  if (!rows.length) return res.status(404).json({ message: "Topic not found" });
  res.json(rows[0]);
});
app.put("/api/topics/:id", auth, async (req, res) => {
  const { name, type, description, color, keywords } = req.body;
  await query("UPDATE topics SET name=?, type=?, description=?, color=?, keywords=? WHERE id=? AND user_id=?", [name, type, description, color, keywords || name, req.params.id, scopedUserId(req)]);
  res.json({ message: "Topic updated" });
});
app.delete("/api/topics/:id", auth, async (req, res) => {
  await query("DELETE FROM topics WHERE id=? AND user_id=?", [req.params.id, scopedUserId(req)]);
  res.json({ message: "Topic deleted" });
});

app.get("/api/sources", auth, async (req, res) => {
  const sources = await query(
    `SELECT s.*, t.name AS topic_name,
    (SELECT COUNT(*) FROM posts p WHERE p.source_id=s.id) AS post_count,
    (SELECT COUNT(*) FROM collection_runs cr WHERE cr.source_id=s.id) AS run_count
    FROM sources s LEFT JOIN topics t ON s.topic_id=t.id
    WHERE s.user_id=? ORDER BY s.created_at DESC`,
    [scopedUserId(req)]
  );
  res.json(sources);
});

app.post("/api/sources", auth, async (req, res) => {
  const { name, type, topicId, query: sourceQuery, url, enabled = false, pollIntervalSeconds = 300 } = req.body;
  if (!name || !type) return res.status(400).json({ message: "Name and type are required" });
  const result = await query(
    `INSERT INTO sources (user_id,name,type,topic_id,query,url,enabled,poll_interval_seconds,status)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [req.user.id, name, type, topicId || null, sourceQuery || "", url || "", Boolean(enabled), Number(pollIntervalSeconds || 300), enabled ? "starting" : "paused"]
  );
  await reloadSourceWorkers();
  res.status(201).json({ id: result.insertId });
});

app.put("/api/sources/:id", auth, async (req, res) => {
  const { name, type, topicId, query: sourceQuery, url, enabled, pollIntervalSeconds } = req.body;
  await query(
    `UPDATE sources SET name=?, type=?, topic_id=?, query=?, url=?, enabled=?, poll_interval_seconds=?, status=IF(?,'starting','paused')
     WHERE id=? AND user_id=?`,
    [name, type, topicId || null, sourceQuery || "", url || "", Boolean(enabled), Number(pollIntervalSeconds || 300), Boolean(enabled), req.params.id, scopedUserId(req)]
  );
  const worker = sourceWorkers.get(Number(req.params.id));
  if (worker) {
    worker.stop();
    sourceWorkers.delete(Number(req.params.id));
  }
  await reloadSourceWorkers();
  res.json({ message: "Source updated" });
});

app.delete("/api/sources/:id", auth, async (req, res) => {
  const worker = sourceWorkers.get(Number(req.params.id));
  if (worker) {
    worker.stop();
    sourceWorkers.delete(Number(req.params.id));
  }
  await query("DELETE FROM sources WHERE id=? AND user_id=?", [req.params.id, scopedUserId(req)]);
  res.json({ message: "Source deleted" });
});

app.post("/api/sources/:id/test", auth, async (req, res) => {
  const rows = await query("SELECT * FROM sources WHERE id=? AND user_id=?", [req.params.id, scopedUserId(req)]);
  if (!rows.length) return res.status(404).json({ message: "Source not found" });
  const result = await runSourceOnce(rows[0], true);
  res.json(result.ok ? result : { ok: true, ...result });
});

app.post("/api/uploads/csv", auth, upload.single("file"), async (req, res) => {
  const rows = [];
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on("data", (row) => rows.push(row))
    .on("end", async () => {
      try {
        let imported = 0;
        for (const row of rows) if (await insertPost(req.user.id, row)) imported += 1;
        await query("INSERT INTO uploads (user_id,file_name,file_type,row_count,status) VALUES (?,?,?,?,?)", [req.user.id, req.file.originalname, "csv", imported, "completed"]);
        await checkAlerts(req.user.id);
        fs.unlinkSync(req.file.path);
        sendLiveEvent(req.user.id, { type: "upload_imported", imported, fileType: "csv" });
        res.status(201).json({ imported });
      } catch (error) {
        res.status(500).json({ message: "Upload failed", detail: error.message });
      }
    });
});
app.post("/api/uploads/json", auth, upload.single("file"), async (req, res) => {
  const raw = JSON.parse(fs.readFileSync(req.file.path, "utf8"));
  const rows = Array.isArray(raw) ? raw : raw.posts || [];
  let imported = 0;
  for (const row of rows) if (await insertPost(req.user.id, row)) imported += 1;
  await query("INSERT INTO uploads (user_id,file_name,file_type,row_count,status) VALUES (?,?,?,?,?)", [req.user.id, req.file.originalname, "json", imported, "completed"]);
  await checkAlerts(req.user.id);
  fs.unlinkSync(req.file.path);
  sendLiveEvent(req.user.id, { type: "upload_imported", imported, fileType: "json" });
  res.status(201).json({ imported });
});

app.get("/api/posts", auth, async (req, res) => {
  let posts = await postsForUser(scopedUserId(req), req.query.topicId);
  if (req.query.sentiment) posts = posts.filter((post) => post.sentiment_label === req.query.sentiment);
  if (req.query.platform) posts = posts.filter((post) => post.platform === req.query.platform);
  const sort = req.query.sort || "recent";
  if (sort === "engagement") posts.sort((a, b) => b.engagement - a.engagement);
  if (sort === "negative") posts.sort((a, b) => a.sentiment_score - b.sentiment_score);
  res.json(posts);
});
app.get("/api/posts/top", auth, async (req, res) => {
  const posts = await postsForUser(scopedUserId(req));
  res.json(posts.sort((a, b) => b.engagement - a.engagement).slice(0, 10));
});
app.get("/api/posts/topic/:topicId", auth, async (req, res) => res.json(await postsForUser(scopedUserId(req), req.params.topicId)));

app.get("/api/analytics/overview", auth, async (req, res) => res.json(await analytics(scopedUserId(req), req.query.topicId)));
app.get("/api/analytics/sentiment", auth, async (req, res) => {
  const data = await analytics(scopedUserId(req), req.query.topicId);
  res.json(data.sentiment);
});
app.get("/api/analytics/trends", auth, async (req, res) => {
  const data = await analytics(scopedUserId(req), req.query.topicId);
  res.json(data.trends);
});
app.get("/api/analytics/competitors", auth, async (req, res) => {
  const data = await analytics(scopedUserId(req));
  res.json(data.competitors);
});

app.get("/api/summary/topic/:topicId", auth, async (req, res) => {
  const data = await analytics(scopedUserId(req), req.params.topicId);
  const negativePct = data.totalMentions ? Math.round((data.sentiment.negative / data.totalMentions) * 100) : 0;
  const positivePct = data.totalMentions ? Math.round((data.sentiment.positive / data.totalMentions) * 100) : 0;
  const topKeywords = data.keywords.map((k) => k.keyword).join(", ") || "no strong keywords yet";
  const risk = negativePct >= 35 ? "Risk is elevated because negative discussion is above the configured comfort range." : "Risk is currently manageable based on local uploaded data.";
  res.json({
    headline: `${data.totalMentions} local mentions analyzed`,
    summary: `Positive sentiment is ${positivePct}% and negative sentiment is ${negativePct}%. Top recurring terms include ${topKeywords}. ${risk}`,
    risk,
    keywords: data.keywords,
    topPosts: data.topPosts
  });
});

app.get("/api/alerts", auth, async (req, res) => {
  const alerts = await query("SELECT a.*, t.name AS topic_name FROM alerts a LEFT JOIN topics t ON a.topic_id=t.id WHERE a.user_id=? ORDER BY a.created_at DESC", [scopedUserId(req)]);
  const events = await query("SELECT e.*, a.name AS alert_name FROM alert_events e JOIN alerts a ON e.alert_id=a.id WHERE a.user_id=? ORDER BY e.created_at DESC LIMIT 30", [scopedUserId(req)]);
  res.json({ alerts, events });
});
app.post("/api/alerts", auth, async (req, res) => {
  const { topicId, name, conditionType, thresholdValue, enabled = true } = req.body;
  const result = await query("INSERT INTO alerts (user_id,topic_id,name,condition_type,threshold_value,enabled) VALUES (?,?,?,?,?,?)", [req.user.id, topicId || null, name, conditionType, thresholdValue, enabled]);
  res.status(201).json({ id: result.insertId });
});
app.put("/api/alerts/:id", auth, async (req, res) => {
  const { topicId, name, conditionType, thresholdValue, enabled } = req.body;
  await query("UPDATE alerts SET topic_id=?, name=?, condition_type=?, threshold_value=?, enabled=? WHERE id=? AND user_id=?", [topicId || null, name, conditionType, thresholdValue, enabled, req.params.id, scopedUserId(req)]);
  res.json({ message: "Alert updated" });
});
app.delete("/api/alerts/:id", auth, async (req, res) => {
  await query("DELETE FROM alerts WHERE id=? AND user_id=?", [req.params.id, scopedUserId(req)]);
  res.json({ message: "Alert deleted" });
});

async function buildReportData(userId, topicId) {
  const data = await analytics(userId, topicId);
  const topics = await query("SELECT * FROM topics WHERE user_id = ?", [userId]);
  return { data, topics };
}

app.post("/api/reports/pdf", auth, async (req, res) => {
  const { topicId } = req.body;
  const { data } = await buildReportData(req.user.id, topicId);
  const fileName = `opiniontrack-${Date.now()}.pdf`;
  const filePath = path.join(reportDir, fileName);
  const doc = new PDFDocument({ margin: 48 });
  doc.pipe(fs.createWriteStream(filePath));
  doc.fontSize(22).text("OpinionTrack Report");
  doc.moveDown().fontSize(12).text(`Generated: ${new Date().toLocaleString()}`);
  doc.text(`Total mentions: ${data.totalMentions}`);
  doc.text(`Positive: ${data.sentiment.positive} Negative: ${data.sentiment.negative} Neutral: ${data.sentiment.neutral}`);
  doc.moveDown().fontSize(16).text("Top Posts");
  data.topPosts.forEach((post) => doc.fontSize(10).text(`${post.platform} | ${post.sentiment_label} | ${post.content}`));
  doc.end();
  await query("INSERT INTO reports (user_id,topic_id,type,file_path) VALUES (?,?,?,?)", [req.user.id, topicId || null, "pdf", filePath]);
  res.status(201).json({ fileName });
});
app.post("/api/reports/excel", auth, async (req, res) => {
  const { topicId } = req.body;
  const { data } = await buildReportData(req.user.id, topicId);
  const workbook = new ExcelJS.Workbook();
  const overview = workbook.addWorksheet("Overview");
  overview.addRows([["Metric", "Value"], ["Total mentions", data.totalMentions], ["Engagement", data.engagement], ["Positive", data.sentiment.positive], ["Negative", data.sentiment.negative], ["Neutral", data.sentiment.neutral]]);
  const posts = workbook.addWorksheet("Top Posts");
  posts.columns = ["Platform", "Author", "Content", "Sentiment", "Engagement"].map((header) => ({ header, key: header.toLowerCase(), width: 24 }));
  data.topPosts.forEach((post) => posts.addRow({ platform: post.platform, author: post.author, content: post.content, sentiment: post.sentiment_label, engagement: post.engagement }));
  const fileName = `opiniontrack-${Date.now()}.xlsx`;
  const filePath = path.join(reportDir, fileName);
  await workbook.xlsx.writeFile(filePath);
  await query("INSERT INTO reports (user_id,topic_id,type,file_path) VALUES (?,?,?,?)", [req.user.id, topicId || null, "excel", filePath]);
  res.status(201).json({ fileName });
});
app.get("/api/reports", auth, async (req, res) => res.json(await query("SELECT * FROM reports WHERE user_id=? ORDER BY created_at DESC", [scopedUserId(req)])));
app.get("/api/reports/:id/download", auth, async (req, res) => {
  const rows = await query("SELECT * FROM reports WHERE id=? AND user_id=?", [req.params.id, scopedUserId(req)]);
  if (!rows.length) return res.status(404).json({ message: "Report not found" });
  res.download(rows[0].file_path);
});

app.post("/api/demo/refresh", auth, async (req, res) => {
  const samples = [
    "The dashboard feels fast and the charts are helpful.",
    "Support response delay is making customers unhappy.",
    "Competitor pricing is getting more attention this week.",
    "Reports are clean and useful for management reviews."
  ];
  await insertPost(req.user.id, {
    topic: "OpinionTrack",
    platform: "Local Demo",
    author: `demo_${Date.now()}`,
    content: samples[Math.floor(Math.random() * samples.length)],
    postedAt: new Date().toISOString(),
    likes: Math.floor(Math.random() * 60),
    shares: Math.floor(Math.random() * 20),
    comments: Math.floor(Math.random() * 12)
  });
  await checkAlerts(req.user.id);
  sendLiveEvent(req.user.id, { type: "demo_imported", sourceName: "Local Demo" });
  res.status(201).json({ message: "Demo post added" });
});

app.get("/api/admin/stats", auth, adminOnly, async (req, res) => {
  const [[users], [topics], [reports], [alerts], [uploads], [posts], [sources]] = await Promise.all([
    query("SELECT COUNT(*) AS total FROM users"),
    query("SELECT COUNT(*) AS total FROM topics"),
    query("SELECT COUNT(*) AS total FROM reports"),
    query("SELECT COUNT(*) AS total FROM alerts"),
    query("SELECT COUNT(*) AS total FROM uploads"),
    query("SELECT COUNT(*) AS total FROM posts"),
    query("SELECT COUNT(*) AS total FROM sources")
  ]);
  res.json({ users: users.total, topics: topics.total, sources: sources.total, reports: reports.total, alerts: alerts.total, uploads: uploads.total, posts: posts.total });
});
app.get("/api/admin/users", auth, adminOnly, async (req, res) => res.json(await query("SELECT id,name,email,role,status,created_at FROM users ORDER BY created_at DESC")));
app.put("/api/admin/users/:id", auth, adminOnly, async (req, res) => {
  const { name, role, status } = req.body;
  await query("UPDATE users SET name=?, role=?, status=? WHERE id=?", [name, role, status, req.params.id]);
  res.json({ message: "User updated" });
});
app.delete("/api/admin/users/:id", auth, adminOnly, async (req, res) => {
  await query("DELETE FROM users WHERE id=?", [req.params.id]);
  res.json({ message: "User deleted" });
});
app.get("/api/admin/topics", auth, adminOnly, async (req, res) => res.json(await query("SELECT t.*, u.email AS owner FROM topics t JOIN users u ON t.user_id=u.id ORDER BY t.created_at DESC")));
app.get("/api/admin/uploads", auth, adminOnly, async (req, res) => res.json(await query("SELECT up.*, u.email AS owner FROM uploads up JOIN users u ON up.user_id=u.id ORDER BY up.created_at DESC")));
app.get("/api/admin/sources", auth, adminOnly, async (req, res) => res.json(await query("SELECT s.*, u.email AS owner, t.name AS topic_name FROM sources s JOIN users u ON s.user_id=u.id LEFT JOIN topics t ON s.topic_id=t.id ORDER BY s.created_at DESC")));
app.get("/api/admin/reports", auth, adminOnly, async (req, res) => res.json(await query("SELECT r.*, u.email AS owner FROM reports r JOIN users u ON r.user_id=u.id ORDER BY r.created_at DESC")));
app.get("/api/admin/alerts", auth, adminOnly, async (req, res) => res.json(await query("SELECT a.*, u.email AS owner FROM alerts a JOIN users u ON a.user_id=u.id ORDER BY a.created_at DESC")));
app.get("/api/admin/security-logs", auth, adminOnly, async (req, res) => res.json(await query("SELECT s.*, u.email AS owner FROM security_logs s LEFT JOIN users u ON s.user_id=u.id ORDER BY s.created_at DESC LIMIT 100")));
app.get("/api/admin/settings", auth, adminOnly, async (req, res) => res.json(await query("SELECT * FROM settings ORDER BY setting_key")));
app.put("/api/admin/settings", auth, adminOnly, async (req, res) => {
  const { settings } = req.body;
  const items = Array.isArray(settings) ? settings : Object.values(settings || {});
  for (const item of items.filter((entry) => entry?.setting_key)) {
    await query("INSERT INTO settings (setting_key,setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)", [item.setting_key, item.setting_value]);
  }
  res.json({ message: "Settings saved" });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ message: "Server error", detail: error.message });
});

app.listen(PORT, async () => {
  console.log(`OpinionTrack API running on http://localhost:${PORT}`);
  try {
    await reloadSourceWorkers();
    sourceReloadTimer = setInterval(() => reloadSourceWorkers().catch((error) => console.error(error)), 60000);
  } catch (error) {
    console.error("Live source workers could not start:", error.message);
  }
});
