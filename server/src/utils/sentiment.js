import Sentiment from "sentiment";

const sentiment = new Sentiment();

const positiveBoost = ["love", "great", "excellent", "reliable", "useful", "clean", "accurate"];
const negativeBoost = ["failed", "slow", "bad", "hate", "frustrating", "negative", "delayed", "confusing"];

export function analyzeSentiment(text = "") {
  const lower = text.toLowerCase();
  let score = sentiment.analyze(text).score;

  positiveBoost.forEach((word) => {
    if (lower.includes(word)) score += 2;
  });
  negativeBoost.forEach((word) => {
    if (lower.includes(word)) score -= 2;
  });

  const label = score > 1 ? "positive" : score < -1 ? "negative" : "neutral";
  return { score, label };
}

export function extractKeywords(posts) {
  const stop = new Set(["the", "and", "for", "with", "this", "that", "our", "are", "has", "but", "from", "into", "very", "local"]);
  const counts = {};
  posts.forEach((post) => {
    String(post.content || "")
      .toLowerCase()
      .replace(/[^a-z0-9# ]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3 && !stop.has(word))
      .forEach((word) => {
        counts[word] = (counts[word] || 0) + 1;
      });
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([keyword, count]) => ({ keyword, count }));
}
