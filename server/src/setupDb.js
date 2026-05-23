import bcrypt from "bcrypt";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { dbConfig, query } from "./db.js";
import { analyzeSentiment } from "./utils/sentiment.js";

dotenv.config();

const colors = ["#0ea5e9", "#22c55e", "#f97316", "#a855f7"];

const demoPosts = [
  ["Twitter/X", "mira_social", "OpinionTrack gives our team a clear positive view of launch feedback.", "2026-05-20T10:00:00Z", 42, 12, 8, "", "OpinionTrack"],
  ["LinkedIn", "brand_ops", "The reporting workflow is reliable and very useful for weekly reviews.", "2026-05-20T15:40:00Z", 76, 18, 11, "", "OpinionTrack"],
  ["Reddit", "data_jay", "Competitor Pulse looks flashy but support has been slow and frustrating.", "2026-05-21T08:30:00Z", 25, 4, 19, "", "Competitor Pulse"],
  ["Instagram", "citybuzz", "Love the clean dashboard and quick sentiment charts.", "2026-05-21T11:10:00Z", 94, 21, 14, "", "OpinionTrack"],
  ["Twitter/X", "sam_reports", "The upload step failed once but the analytics were accurate after retrying.", "2026-05-21T16:20:00Z", 18, 3, 7, "", "OpinionTrack"],
  ["YouTube", "marketwatcher", "SignalBoard is cheaper but the comparison view is confusing.", "2026-05-22T09:25:00Z", 39, 5, 13, "", "SignalBoard"],
  ["Facebook", "nina_local", "Negative comments are increasing around delayed customer replies.", "2026-05-22T13:50:00Z", 31, 9, 22, "", "OpinionTrack"],
  ["LinkedIn", "tom_growth", "Great local-first tool for students and small businesses tracking public opinion.", "2026-05-22T17:15:00Z", 63, 17, 9, "", "OpinionTrack"]
];

async function main() {
  const bootstrap = await mysql.createConnection({ ...dbConfig, database: undefined });
  await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\``);
  await bootstrap.end();

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(160) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('user','admin') NOT NULL DEFAULT 'user',
      status ENUM('active','disabled') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS topics (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      name VARCHAR(160) NOT NULL,
      type ENUM('keyword','hashtag','brand','competitor') NOT NULL DEFAULT 'keyword',
      description TEXT,
      color VARCHAR(20) DEFAULT '#0ea5e9',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS posts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      topic_id INT NOT NULL,
      platform VARCHAR(80) NOT NULL,
      author VARCHAR(120) NOT NULL,
      content TEXT NOT NULL,
      posted_at DATETIME NOT NULL,
      likes INT DEFAULT 0,
      shares INT DEFAULT 0,
      comments INT DEFAULT 0,
      url VARCHAR(500),
      sentiment_label ENUM('positive','negative','neutral') NOT NULL,
      sentiment_score INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS uploads (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      file_type VARCHAR(20) NOT NULL,
      row_count INT DEFAULT 0,
      status VARCHAR(40) DEFAULT 'completed',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      topic_id INT,
      name VARCHAR(160) NOT NULL,
      condition_type ENUM('negative_threshold','mention_spike','competitor_spike','negative_keyword') NOT NULL,
      threshold_value VARCHAR(80) NOT NULL,
      enabled BOOLEAN DEFAULT TRUE,
      last_triggered_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS alert_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      alert_id INT NOT NULL,
      message TEXT NOT NULL,
      severity ENUM('low','medium','high') DEFAULT 'medium',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      topic_id INT NULL,
      type ENUM('pdf','excel') NOT NULL,
      file_path VARCHAR(500) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS security_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      action VARCHAR(255) NOT NULL,
      ip_address VARCHAR(80),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      setting_key VARCHAR(120) NOT NULL UNIQUE,
      setting_value TEXT
    );
  `);

  const adminHash = await bcrypt.hash("Admin@12345", 10);
  const userHash = await bcrypt.hash("User@12345", 10);
  await query(
    `INSERT IGNORE INTO users (name,email,password_hash,role) VALUES
    ('Admin','admin@opiniontrack.local',?,'admin'),
    ('Demo User','user@opiniontrack.local',?,'user')`,
    [adminHash, userHash]
  );

  const [demoUser] = await query("SELECT id FROM users WHERE email = ?", ["user@opiniontrack.local"]);
  const userId = demoUser.id;
  const topicNames = ["OpinionTrack", "Competitor Pulse", "SignalBoard"];
  for (let i = 0; i < topicNames.length; i += 1) {
    await query(
      "INSERT IGNORE INTO topics (user_id,name,type,description,color) SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM topics WHERE user_id = ? AND name = ?)",
      [userId, topicNames[i], i === 0 ? "brand" : "competitor", "Seeded local demo topic", colors[i], userId, topicNames[i]]
    );
  }

  const existingPosts = await query("SELECT COUNT(*) AS total FROM posts");
  if (existingPosts[0].total === 0) {
    for (const post of demoPosts) {
      const [topic] = await query("SELECT id FROM topics WHERE user_id = ? AND name = ?", [userId, post[8]]);
      const sentiment = analyzeSentiment(post[2]);
      await query(
        `INSERT INTO posts (topic_id,platform,author,content,posted_at,likes,shares,comments,url,sentiment_label,sentiment_score)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [topic.id, post[0], post[1], post[2], new Date(post[3]), post[4], post[5], post[6], post[7], sentiment.label, sentiment.score]
      );
    }
  }

  await query(
    `INSERT IGNORE INTO settings (setting_key, setting_value) VALUES
    ('demo_refresh_enabled','true'),
    ('polling_seconds','20'),
    ('app_name','OpinionTrack')`
  );
  await query(
    "INSERT INTO security_logs (user_id, action, ip_address) VALUES (?, 'Database seeded or verified', 'localhost')",
    [userId]
  );
  await query(
    `INSERT INTO alerts (user_id, topic_id, name, condition_type, threshold_value)
     SELECT ?, id, 'High negative sentiment', 'negative_threshold', '35'
     FROM topics
     WHERE user_id = ? AND name = 'OpinionTrack'
     AND NOT EXISTS (SELECT 1 FROM alerts WHERE user_id = ? AND name = 'High negative sentiment')`,
    [userId, userId, userId]
  );

  console.log("OpinionTrack database setup completed.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
