import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  CheckCircle,
  Download,
  FileSpreadsheet,
  Home,
  LineChart,
  LogOut,
  PauseCircle,
  PlusCircle,
  Radio,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Sparkles,
  Trash2,
  Upload,
  Wifi,
  Users
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import "./styles.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
const api = axios.create({ baseURL: API_URL });
const AuthContext = createContext(null);
const colors = ["#22c55e", "#ef4444", "#94a3b8", "#0ea5e9", "#f97316"];

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("opiniontrack_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

function useAuth() {
  return useContext(AuthContext);
}

function AuthProvider({ children }) {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem("opiniontrack_user") || "null"));
  const [loading, setLoading] = useState(false);

  async function login(email, password) {
    const { data } = await api.post("/auth/login", { email, password });
    localStorage.setItem("opiniontrack_token", data.token);
    localStorage.setItem("opiniontrack_user", JSON.stringify(data.user));
    setUser(data.user);
  }

  async function register(payload) {
    const { data } = await api.post("/auth/register", payload);
    localStorage.setItem("opiniontrack_token", data.token);
    localStorage.setItem("opiniontrack_user", JSON.stringify(data.user));
    setUser(data.user);
  }

  function logout() {
    localStorage.removeItem("opiniontrack_token");
    localStorage.removeItem("opiniontrack_user");
    setUser(null);
  }

  useEffect(() => {
    const token = localStorage.getItem("opiniontrack_token");
    if (!token) return;
    setLoading(true);
    api.get("/auth/me").then(({ data }) => setUser(data.user)).catch(logout).finally(() => setLoading(false));
  }, []);

  const value = useMemo(() => ({ user, loading, login, register, logout }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function Protected({ children, admin = false }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== "admin") return <Navigate to="/dashboard" replace />;
  return children;
}

function Shell({ children, admin = false }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const items = admin
    ? [
        ["/admin", Home, "Overview"],
        ["/admin/users", Users, "Users"],
        ["/admin/topics", Search, "Topics"],
        ["/admin/sources", Radio, "Sources"],
        ["/admin/uploads", Upload, "Uploads"],
        ["/admin/reports", FileSpreadsheet, "Reports"],
        ["/admin/alerts", Bell, "Alerts"],
        ["/admin/settings", Settings, "Settings"]
      ]
    : [
        ["/dashboard", Home, "Dashboard"],
        ["/topics/new", PlusCircle, "Add Topic"],
        ["/sources", Radio, "Live Sources"],
        ["/monitoring", Activity, "Monitoring"],
        ["/sentiment", BarChart3, "Sentiment"],
        ["/summary", Sparkles, "AI Summary"],
        ["/alerts", Bell, "Alerts"],
        ["/reports", Download, "Reports"],
        ["/competitors", LineChart, "Competitors"],
        ["/setup", CheckCircle, "Setup"],
        ["/settings", Settings, "Settings"]
      ];

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 border-r border-white/70 bg-white/80 p-5 shadow-panel backdrop-blur xl:block">
        <Link to={admin ? "/admin" : "/dashboard"} className="mb-8 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-slate-950 text-white shadow-lift">
            <BarChart3 size={22} />
          </div>
          <div>
            <p className="text-lg font-black">OpinionTrack</p>
            <p className="text-xs text-slate-500">{admin ? "Admin Panel" : "Local Intelligence"}</p>
          </div>
        </Link>
        <nav className="space-y-1">
          {items.map(([href, Icon, label]) => (
            <Link key={href} to={href} className={`nav-link ${location.pathname === href ? "nav-active" : ""}`}>
              <Icon size={18} />
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="xl:pl-72">
        <header className="sticky top-0 z-10 border-b border-white/70 bg-white/80 px-5 py-4 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-500">{admin ? "Admin Workspace" : "User Workspace"}</p>
              <h1 className="text-xl font-black">Free localhost opinion tracking</h1>
            </div>
            <div className="flex items-center gap-3">
              {user?.role === "admin" && !admin && <Link className="btn-secondary" to="/admin"><Shield size={16} /> Admin</Link>}
              <span className="hidden rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-panel sm:inline">{user?.email}</span>
              <button className="icon-btn" onClick={logout} title="Log out"><LogOut size={18} /></button>
            </div>
          </div>
        </header>
        <MobileNav admin={admin} items={items} />
        <motion.section className="mx-auto max-w-7xl p-5" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          {children}
        </motion.section>
      </main>
    </div>
  );
}

function MobileNav({ items }) {
  return (
    <div className="grid grid-cols-4 gap-2 border-b border-white/70 bg-white/90 p-3 xl:hidden">
      {items.slice(0, 8).map(([href, Icon, label]) => (
        <Link key={href} to={href} className="flex min-h-14 flex-col items-center justify-center rounded-lg bg-slate-50 text-[11px] font-semibold text-slate-600">
          <Icon size={17} />
          {label}
        </Link>
      ))}
    </div>
  );
}

function Landing() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <section className="relative overflow-hidden px-6 py-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(14,165,233,.24),transparent_32%),radial-gradient(circle_at_80%_10%,rgba(34,197,94,.2),transparent_28%)]" />
        <nav className="relative mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3 font-black"><BarChart3 /> OpinionTrack</div>
          <div className="flex gap-3">
            <Link className="btn-ghost" to="/login">Login</Link>
            <Link className="btn-primary" to="/register">Register</Link>
          </div>
        </nav>
        <div className="relative mx-auto grid max-w-7xl gap-10 py-20 lg:grid-cols-[1fr_.9fr] lg:items-center">
          <div>
            <p className="mb-4 text-sm font-bold uppercase tracking-widest text-sky-300">100% local, no paid APIs</p>
            <h1 className="max-w-4xl text-5xl font-black leading-tight md:text-7xl">OpinionTrack</h1>
            <p className="mt-6 max-w-2xl text-lg text-slate-300">Track public opinion from uploaded CSV/JSON data, demo feeds, local sentiment analysis, smart alerts, competitor comparison, and downloadable reports.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link className="btn-primary" to="/login">Open Dashboard</Link>
              <Link className="btn-ghost" to="/register">Create Account</Link>
            </div>
          </div>
          <div className="dashboard-hero">
            <div className="hero-bar" />
            <div className="grid gap-4 md:grid-cols-3">
              {["Mentions", "Positive", "Alerts"].map((label, i) => (
                <div key={label} className="rounded-xl border border-white/10 bg-white/10 p-5">
                  <p className="text-sm text-slate-300">{label}</p>
                  <p className="mt-2 text-3xl font-black">{[1284, "64%", 7][i]}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 h-52 rounded-xl border border-white/10 bg-slate-900/80 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={[{ date: "Mon", mentions: 12 }, { date: "Tue", mentions: 26 }, { date: "Wed", mentions: 18 }, { date: "Thu", mentions: 44 }, { date: "Fri", mentions: 38 }]}>
                  <Area dataKey="mentions" stroke="#38bdf8" fill="#38bdf855" />
                  <XAxis dataKey="date" stroke="#94a3b8" />
                  <Tooltip />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function AuthPage({ type }) {
  const isLogin = type === "login";
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: isLogin ? "user@opiniontrack.local" : "", password: isLogin ? "User@12345" : "" });
  const [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    setError("");
    try {
      if (isLogin) await login(form.email, form.password);
      else await register(form);
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.message || "Authentication failed");
    }
  }
  return (
    <div className="grid min-h-screen place-items-center bg-slate-100 p-5">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lift">
        <Link to="/" className="mb-8 flex items-center gap-3 text-xl font-black"><BarChart3 /> OpinionTrack</Link>
        <h1 className="text-3xl font-black">{isLogin ? "Welcome back" : "Create account"}</h1>
        <p className="mt-2 text-sm text-slate-500">{isLogin ? "Use the seeded demo accounts or your registered user." : "Registration creates a normal user account."}</p>
        {!isLogin && <input className="field mt-6" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
        <input className="field mt-4" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input className="field mt-4" type="password" placeholder="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
        <button className="btn-primary mt-6 w-full justify-center">{isLogin ? "Login" : "Register"}</button>
        <Link className="mt-5 block text-center text-sm font-semibold text-sky-700" to={isLogin ? "/register" : "/login"}>{isLogin ? "Need an account?" : "Already have an account?"}</Link>
      </form>
    </div>
  );
}

function Stat({ label, value, icon: Icon }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-500">{label}</p>
        <Icon className="text-sky-600" size={20} />
      </div>
      <p className="mt-3 text-3xl font-black">{value ?? 0}</p>
    </div>
  );
}

function useLiveRefresh(onEvent) {
  useEffect(() => {
    const token = localStorage.getItem("opiniontrack_token");
    if (!token) return;
    const stream = new EventSource(`${API_URL}/live/events?token=${encodeURIComponent(token)}`);
    stream.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type !== "connected") onEvent?.(payload);
    };
    return () => stream.close();
  }, [onEvent]);
}

function useOverview() {
  const [data, setData] = useState(null);
  const load = useCallback(() => api.get("/analytics/overview").then(({ data }) => setData(data)), []);
  useEffect(() => {
    load();
    const timer = setInterval(load, 20000);
    return () => clearInterval(timer);
  }, [load]);
  useLiveRefresh(load);
  return { data, reload: load };
}

function Dashboard() {
  const { data, reload } = useOverview();
  async function refresh() {
    await api.post("/demo/refresh");
    reload();
  }
  const pie = data ? Object.entries(data.sentiment).map(([name, value]) => ({ name, value })) : [];
  return (
    <Shell>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="page-title">User Dashboard</h2><p className="muted">Local social opinion metrics refresh automatically.</p></div>
        <button className="btn-primary" onClick={refresh}><RefreshCw size={16} /> Demo Refresh</button>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Total mentions" value={data?.totalMentions} icon={Activity} />
        <Stat label="Engagement" value={data?.engagement} icon={BarChart3} />
        <Stat label="Positive" value={data?.sentiment?.positive} icon={Sparkles} />
        <Stat label="Negative" value={data?.sentiment?.negative} icon={AlertTriangle} />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_.8fr]">
        <ChartCard title="Mention Trend"><TrendChart data={data?.trends || []} /></ChartCard>
        <ChartCard title="Sentiment Split"><SentimentPie data={pie} /></ChartCard>
      </div>
      <PostList posts={data?.topPosts || []} title="Top posts" />
    </Shell>
  );
}

function ChartCard({ title, children }) {
  return <div className="card h-96"><h3 className="section-title">{title}</h3>{children}</div>;
}

function TrendChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height="88%">
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" />
        <YAxis allowDecimals={false} />
        <Tooltip />
        <Legend />
        <Area type="monotone" dataKey="mentions" stroke="#0ea5e9" fill="#0ea5e933" />
        <Area type="monotone" dataKey="negative" stroke="#ef4444" fill="#ef444433" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function SentimentPie({ data }) {
  return (
    <ResponsiveContainer width="100%" height="88%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" outerRadius={105} label>
          {data.map((entry, index) => <Cell key={entry.name} fill={colors[index]} />)}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}

function TopicForm() {
  const [form, setForm] = useState({ name: "", type: "keyword", description: "", color: "#0ea5e9", keywords: "" });
  const [message, setMessage] = useState("");
  async function submit(e) {
    e.preventDefault();
    await api.post("/topics", form);
    setMessage("Topic created.");
    setForm({ name: "", type: "keyword", description: "", color: "#0ea5e9", keywords: "" });
  }
  return (
    <Shell>
      <h2 className="page-title">Add Tracking Topic</h2>
      <form onSubmit={submit} className="card mt-5 max-w-2xl">
        <input className="field" required placeholder="Keyword, hashtag, brand, or competitor" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select className="field mt-4" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          <option value="keyword">Keyword</option><option value="hashtag">Hashtag</option><option value="brand">Brand</option><option value="competitor">Competitor</option>
        </select>
        <input className="field mt-4" placeholder="Comma-separated live matching terms" value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} />
        <textarea className="field mt-4" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <input className="field mt-4 h-12" type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
        <button className="btn-primary mt-5"><PlusCircle size={16} /> Save topic</button>
        {message && <p className="mt-4 text-sm font-semibold text-green-700">{message}</p>}
      </form>
    </Shell>
  );
}

function Monitoring() {
  const [posts, setPosts] = useState([]);
  const [sort, setSort] = useState("recent");
  const [sentiment, setSentiment] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(() => api.get("/posts", { params: { sort, sentiment: sentiment || undefined } }).then(({ data }) => setPosts(data)), [sort, sentiment]);
  useEffect(() => {
    load();
    const timer = setInterval(load, 20000);
    return () => clearInterval(timer);
  }, [load]);
  useLiveRefresh(load);
  async function uploadFile(e, type) {
    const file = e.target.files[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const { data } = await api.post(`/uploads/${type}`, form);
    setMessage(`Imported ${data.imported} posts.`);
    load();
  }
  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h2 className="page-title">Social Media Monitoring</h2><p className="muted">Upload local CSV/JSON data and inspect analyzed posts.</p></div>
        <div className="flex flex-wrap gap-3">
          <label className="btn-secondary"><Upload size={16} /> CSV<input hidden type="file" accept=".csv" onChange={(e) => uploadFile(e, "csv")} /></label>
          <label className="btn-secondary"><Upload size={16} /> JSON<input hidden type="file" accept=".json" onChange={(e) => uploadFile(e, "json")} /></label>
        </div>
      </div>
      {message && <p className="mt-4 rounded-lg bg-green-50 p-3 font-semibold text-green-700">{message}</p>}
      <div className="mt-5 flex flex-wrap gap-3">
        <select className="field max-w-xs" value={sort} onChange={(e) => setSort(e.target.value)}><option value="recent">Recent</option><option value="engagement">Engagement</option><option value="negative">Negative first</option></select>
        <select className="field max-w-xs" value={sentiment} onChange={(e) => setSentiment(e.target.value)}><option value="">All sentiment</option><option value="positive">Positive</option><option value="negative">Negative</option><option value="neutral">Neutral</option></select>
      </div>
      <PostList posts={posts} title="Tracked posts" />
    </Shell>
  );
}

function PostList({ posts, title }) {
  return (
    <div className="card mt-5">
      <h3 className="section-title">{title}</h3>
      <div className="mt-4 overflow-x-auto">
        <table className="table">
          <thead><tr><th>Platform</th><th>Topic</th><th>Author</th><th>Content</th><th>Sentiment</th><th>Engagement</th></tr></thead>
          <tbody>
            {posts.map((post) => (
              <tr key={post.id}><td>{post.platform}</td><td>{post.topic_name}</td><td>{post.author}</td><td className="min-w-80">{post.content}</td><td><Badge value={post.sentiment_label} /></td><td>{post.engagement}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Badge({ value }) {
  const cls = value === "positive" ? "bg-green-100 text-green-700" : value === "negative" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700";
  return <span className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${cls}`}>{value}</span>;
}

function SentimentPage() {
  const { data } = useOverview();
  const pie = data ? Object.entries(data.sentiment).map(([name, value]) => ({ name, value })) : [];
  return <Shell><h2 className="page-title">Sentiment Analysis</h2><div className="mt-5 grid gap-5 lg:grid-cols-2"><ChartCard title="Sentiment Distribution"><SentimentPie data={pie} /></ChartCard><ChartCard title="Keywords"><KeywordChart data={data?.keywords || []} /></ChartCard></div><PostList posts={data?.topPosts || []} title="High-engagement posts" /></Shell>;
}

function KeywordChart({ data }) {
  return <ResponsiveContainer width="100%" height="88%"><BarChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="keyword" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" fill="#0ea5e9" /></BarChart></ResponsiveContainer>;
}

function SummaryPage() {
  const [topics, setTopics] = useState([]);
  const [topicId, setTopicId] = useState("");
  const [summary, setSummary] = useState(null);
  useEffect(() => { api.get("/topics").then(({ data }) => { setTopics(data); setTopicId(String(data[0]?.id || "")); }); }, []);
  useEffect(() => { if (topicId) api.get(`/summary/topic/${topicId}`).then(({ data }) => setSummary(data)); }, [topicId]);
  return (
    <Shell>
      <h2 className="page-title">AI Summary</h2>
      <select className="field mt-5 max-w-sm" value={topicId} onChange={(e) => setTopicId(e.target.value)}>{topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      {summary && <div className="card mt-5"><p className="text-sm font-bold text-sky-700">{summary.headline}</p><h3 className="mt-3 text-2xl font-black">Local rule-based insight</h3><p className="mt-3 text-slate-600">{summary.summary}</p><div className="mt-4 flex flex-wrap gap-2">{summary.keywords.map((k) => <span className="rounded-full bg-sky-50 px-3 py-1 text-sm font-bold text-sky-700" key={k.keyword}>{k.keyword} · {k.count}</span>)}</div></div>}
    </Shell>
  );
}

function AlertsPage() {
  const [payload, setPayload] = useState({ alerts: [], events: [] });
  const [topics, setTopics] = useState([]);
  const [form, setForm] = useState({ name: "New alert", topicId: "", conditionType: "negative_threshold", thresholdValue: "35", enabled: true });
  const load = () => api.get("/alerts").then(({ data }) => setPayload(data));
  useEffect(() => { load(); api.get("/topics").then(({ data }) => { setTopics(data); setForm((f) => ({ ...f, topicId: data[0]?.id || "" })); }); }, []);
  async function submit(e) { e.preventDefault(); await api.post("/alerts", form); load(); }
  return (
    <Shell>
      <h2 className="page-title">Smart Alerts</h2>
      <form onSubmit={submit} className="card mt-5 grid gap-3 md:grid-cols-5">
        <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select className="field" value={form.topicId} onChange={(e) => setForm({ ...form, topicId: e.target.value })}>{topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <select className="field" value={form.conditionType} onChange={(e) => setForm({ ...form, conditionType: e.target.value })}><option value="negative_threshold">Negative threshold</option><option value="mention_spike">Mention spike</option><option value="competitor_spike">Competitor spike</option><option value="negative_keyword">Negative keyword</option></select>
        <input className="field" value={form.thresholdValue} onChange={(e) => setForm({ ...form, thresholdValue: e.target.value })} />
        <button className="btn-primary justify-center"><Bell size={16} /> Create</button>
      </form>
      <SimpleTable title="Active alerts" rows={payload.alerts} columns={["name", "topic_name", "condition_type", "threshold_value", "enabled", "last_triggered_at"]} />
      <SimpleTable title="Alert events" rows={payload.events} columns={["alert_name", "message", "severity", "created_at"]} />
    </Shell>
  );
}

function LiveSourcesPage() {
  const [sources, setSources] = useState([]);
  const [topics, setTopics] = useState([]);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    name: "RSS keyword monitor",
    type: "rss",
    topicId: "",
    query: "social media, sentiment, analytics",
    url: "https://hnrss.org/frontpage",
    enabled: false,
    pollIntervalSeconds: 300
  });
  const load = useCallback(() => api.get("/sources").then(({ data }) => setSources(data)), []);
  useEffect(() => {
    load();
    api.get("/topics").then(({ data }) => {
      setTopics(data);
      setForm((current) => ({ ...current, topicId: data[0]?.id || "" }));
    });
  }, [load]);
  useLiveRefresh(load);

  function preset(type) {
    if (type === "bluesky") setForm({ ...form, name: "Bluesky keyword stream", type, query: "opiniontrack, sentiment, social listening", url: "wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post", enabled: false, pollIntervalSeconds: 60 });
    if (type === "mastodon") setForm({ ...form, name: "Mastodon hashtag stream", type, query: "opensource", url: "https://mastodon.social", enabled: false, pollIntervalSeconds: 60 });
    if (type === "rss") setForm({ ...form, name: "RSS keyword monitor", type, query: "social media, sentiment, analytics", url: "https://hnrss.org/frontpage", enabled: false, pollIntervalSeconds: 300 });
  }

  async function save(e) {
    e.preventDefault();
    await api.post("/sources", form);
    setMessage("Source saved.");
    load();
  }

  async function toggle(source) {
    await api.put(`/sources/${source.id}`, { ...source, topicId: source.topic_id || "", pollIntervalSeconds: source.poll_interval_seconds, enabled: !source.enabled });
    setMessage(!source.enabled ? "Live source started." : "Live source paused.");
    load();
  }

  async function test(source) {
    const { data } = await api.post(`/sources/${source.id}/test`);
    setMessage(data.message || `Source OK. Sample items: ${data.sampleCount ?? 0}`);
    load();
  }

  async function remove(source) {
    await api.delete(`/sources/${source.id}`);
    setMessage("Source deleted.");
    load();
  }

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h2 className="page-title">Live Sources</h2><p className="muted">Free near-real-time collection from Bluesky, Mastodon, and RSS.</p></div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => preset("bluesky")}><Radio size={16} /> Bluesky</button>
          <button className="btn-secondary" onClick={() => preset("mastodon")}><Wifi size={16} /> Mastodon</button>
          <button className="btn-secondary" onClick={() => preset("rss")}><FileSpreadsheet size={16} /> RSS</button>
        </div>
      </div>
      {message && <p className="mt-4 rounded-lg bg-sky-50 p-3 font-semibold text-sky-800">{message}</p>}
      <form onSubmit={save} className="card mt-5 grid gap-3 lg:grid-cols-6">
        <input className="field lg:col-span-2" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select className="field" value={form.type} onChange={(e) => preset(e.target.value)}>
          <option value="rss">RSS</option><option value="bluesky">Bluesky</option><option value="mastodon">Mastodon</option><option value="reddit">Reddit stub</option><option value="youtube">YouTube stub</option>
        </select>
        <select className="field" value={form.topicId} onChange={(e) => setForm({ ...form, topicId: e.target.value })}>{topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <input className="field lg:col-span-2" placeholder="Keywords or hashtag" value={form.query} onChange={(e) => setForm({ ...form, query: e.target.value })} />
        <input className="field lg:col-span-4" placeholder="Feed, instance, or websocket URL" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
        <input className="field" type="number" min="60" value={form.pollIntervalSeconds} onChange={(e) => setForm({ ...form, pollIntervalSeconds: Number(e.target.value) })} />
        <button className="btn-primary justify-center"><PlusCircle size={16} /> Save source</button>
      </form>
      <div className="card mt-5 overflow-x-auto">
        <table className="table">
          <thead><tr><th>Name</th><th>Type</th><th>Topic</th><th>Status</th><th>Imported</th><th>Last run</th><th>Error</th><th>Actions</th></tr></thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.id}>
                <td>{source.name}<p className="muted">{source.query}</p></td>
                <td>{source.type}</td>
                <td>{source.topic_name || "Any"}</td>
                <td><Badge value={source.enabled ? source.status : "paused"} /></td>
                <td>{source.post_count}</td>
                <td>{source.last_run_at || ""}</td>
                <td className="max-w-xs">{source.last_error || ""}</td>
                <td><div className="flex flex-wrap gap-2"><button className="btn-secondary" onClick={() => toggle(source)}>{source.enabled ? <PauseCircle size={16} /> : <Radio size={16} />}{source.enabled ? "Pause" : "Start"}</button><button className="btn-secondary" onClick={() => test(source)}>Test</button><button className="icon-btn" onClick={() => remove(source)} title="Delete source"><Trash2 size={16} /></button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

function ReportsPage() {
  const [reports, setReports] = useState([]);
  const load = () => api.get("/reports").then(({ data }) => setReports(data));
  useEffect(load, []);
  async function generate(type) {
    await api.post(`/reports/${type}`, {});
    load();
  }
  async function downloadReport(report) {
    const response = await api.get(`/reports/${report.id}/download`, { responseType: "blob" });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement("a");
    link.href = url;
    link.download = `opiniontrack-report-${report.id}.${report.type === "pdf" ? "pdf" : "xlsx"}`;
    link.click();
    window.URL.revokeObjectURL(url);
  }
  return (
    <Shell>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="page-title">Auto Reports</h2><div className="flex gap-3"><button className="btn-primary" onClick={() => generate("pdf")}>PDF</button><button className="btn-secondary" onClick={() => generate("excel")}>Excel</button></div></div>
      <div className="card mt-5 overflow-x-auto"><table className="table"><thead><tr><th>ID</th><th>Type</th><th>Created</th><th>Download</th></tr></thead><tbody>{reports.map((r) => <tr key={r.id}><td>{r.id}</td><td>{r.type}</td><td>{r.created_at}</td><td><button className="btn-secondary inline-flex" onClick={() => downloadReport(r)}><Download size={16} /> Download</button></td></tr>)}</tbody></table></div>
    </Shell>
  );
}

function CompetitorsPage() {
  const [data, setData] = useState([]);
  useEffect(() => { api.get("/analytics/competitors").then(({ data }) => setData(data)); }, []);
  return <Shell><h2 className="page-title">Competitor Comparison</h2><div className="card mt-5 h-[520px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis /><Tooltip /><Legend /><Bar dataKey="mentions" fill="#0ea5e9" /><Bar dataKey="engagement" fill="#22c55e" /><Bar dataKey="negative" fill="#ef4444" /></BarChart></ResponsiveContainer></div></Shell>;
}

function SetupPage() {
  const [status, setStatus] = useState(null);
  const load = useCallback(() => api.get("/setup/status").then(({ data }) => setStatus(data)), []);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load);
  const checks = [
    ["API", status?.api === "running", "Express API responds on localhost."],
    ["Database", status?.database === "connected", "MySQL is connected and schema is ready."],
    ["Sources", Number(status?.sources || 0) > 0, `${status?.sources || 0} source presets or saved sources found.`],
    ["Enabled", Number(status?.enabledSources || 0) > 0, `${status?.enabledSources || 0} live sources enabled.`],
    ["Workers", Number(status?.workerCount || 0) > 0, `${status?.workerCount || 0} background workers active.`]
  ];
  return (
    <Shell>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="page-title">Local Demo Setup</h2><p className="muted">Use this page before presenting the project.</p></div><button className="btn-primary" onClick={load}><RefreshCw size={16} /> Check now</button></div>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {checks.map(([label, ok, detail]) => <div key={label} className="card"><div className="flex items-center gap-2 font-black">{ok ? <CheckCircle className="text-green-600" /> : <AlertTriangle className="text-amber-600" />}{label}</div><p className="muted mt-3">{detail}</p></div>)}
      </div>
      <div className="card mt-5">
        <h3 className="section-title">Demo flow</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {["Log in with the demo user", "Open Live Sources and start RSS", "Watch dashboard metrics update", "Generate PDF or Excel report"].map((item) => <div className="rounded-lg bg-slate-50 p-4 text-sm font-bold text-slate-700" key={item}>{item}</div>)}
        </div>
        {status?.latestRun && <p className="muted mt-4">Latest source run: {status.latestRun.source_name} imported {status.latestRun.imported_count} and skipped {status.latestRun.skipped_count}.</p>}
      </div>
    </Shell>
  );
}

function SettingsPage() {
  const { user } = useAuth();
  return <Shell><h2 className="page-title">Settings</h2><div className="card mt-5"><p className="font-bold">Account</p><p className="muted mt-2">{user?.name} · {user?.email}</p><p className="mt-6 font-bold">Data mode</p><p className="muted mt-2">OpinionTrack uses local uploads, seeded demo data, and local refresh simulation only.</p></div></Shell>;
}

function AdminPage() {
  const [stats, setStats] = useState({});
  useEffect(() => { api.get("/admin/stats").then(({ data }) => setStats(data)); }, []);
  return <Shell admin><h2 className="page-title">Admin Dashboard</h2><div className="mt-5 grid gap-4 md:grid-cols-3">{Object.entries(stats).map(([k, v]) => <Stat key={k} label={k} value={v} icon={Shield} />)}</div></Shell>;
}

function AdminTablePage({ title, endpoint, columns }) {
  const [rows, setRows] = useState([]);
  useEffect(() => { api.get(endpoint).then(({ data }) => setRows(data)); }, [endpoint]);
  return <Shell admin><h2 className="page-title">{title}</h2><SimpleTable rows={rows} columns={columns} /></Shell>;
}

function AdminSettings() {
  const [settings, setSettings] = useState([]);
  useEffect(() => { api.get("/admin/settings").then(({ data }) => setSettings(data)); }, []);
  async function save() { await api.put("/admin/settings", { settings }); }
  return <Shell admin><h2 className="page-title">Manage Settings</h2><div className="card mt-5 space-y-3">{settings.map((s, i) => <div className="grid gap-3 md:grid-cols-2" key={s.id}><input className="field" value={s.setting_key} readOnly /><input className="field" value={s.setting_value || ""} onChange={(e) => setSettings(settings.map((x, ix) => ix === i ? { ...x, setting_value: e.target.value } : x))} /></div>)}<button className="btn-primary" onClick={save}>Save settings</button></div></Shell>;
}

function SimpleTable({ title, rows = [], columns = [] }) {
  const keys = columns.length ? columns : Object.keys(rows[0] || {});
  return <div className="card mt-5 overflow-x-auto">{title && <h3 className="section-title">{title}</h3>}<table className="table mt-3"><thead><tr>{keys.map((k) => <th key={k}>{k.replaceAll("_", " ")}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={row.id || i}>{keys.map((k) => <td key={k}>{String(row[k] ?? "")}</td>)}</tr>)}</tbody></table></div>;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<AuthPage type="login" />} />
          <Route path="/register" element={<AuthPage type="register" />} />
          <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
          <Route path="/topics/new" element={<Protected><TopicForm /></Protected>} />
          <Route path="/sources" element={<Protected><LiveSourcesPage /></Protected>} />
          <Route path="/monitoring" element={<Protected><Monitoring /></Protected>} />
          <Route path="/sentiment" element={<Protected><SentimentPage /></Protected>} />
          <Route path="/summary" element={<Protected><SummaryPage /></Protected>} />
          <Route path="/alerts" element={<Protected><AlertsPage /></Protected>} />
          <Route path="/reports" element={<Protected><ReportsPage /></Protected>} />
          <Route path="/competitors" element={<Protected><CompetitorsPage /></Protected>} />
          <Route path="/setup" element={<Protected><SetupPage /></Protected>} />
          <Route path="/settings" element={<Protected><SettingsPage /></Protected>} />
          <Route path="/admin" element={<Protected admin><AdminPage /></Protected>} />
          <Route path="/admin/users" element={<Protected admin><AdminTablePage title="Manage Users" endpoint="/admin/users" columns={["id", "name", "email", "role", "status", "created_at"]} /></Protected>} />
          <Route path="/admin/topics" element={<Protected admin><AdminTablePage title="Manage Topics" endpoint="/admin/topics" columns={["id", "name", "type", "owner", "created_at"]} /></Protected>} />
          <Route path="/admin/sources" element={<Protected admin><AdminTablePage title="Manage Sources" endpoint="/admin/sources" columns={["id", "name", "type", "topic_name", "status", "enabled", "owner", "last_error", "created_at"]} /></Protected>} />
          <Route path="/admin/uploads" element={<Protected admin><AdminTablePage title="Manage Uploaded Data" endpoint="/admin/uploads" columns={["id", "file_name", "file_type", "row_count", "status", "owner", "created_at"]} /></Protected>} />
          <Route path="/admin/reports" element={<Protected admin><AdminTablePage title="Manage Reports" endpoint="/admin/reports" columns={["id", "type", "file_path", "owner", "created_at"]} /></Protected>} />
          <Route path="/admin/alerts" element={<Protected admin><AdminTablePage title="Manage Alerts" endpoint="/admin/alerts" columns={["id", "name", "condition_type", "threshold_value", "enabled", "owner", "created_at"]} /></Protected>} />
          <Route path="/admin/settings" element={<Protected admin><AdminSettings /></Protected>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

createRoot(document.getElementById("root")).render(<App />);
