/* OpinionPulse · app.js */

// ── State ─────────────────────────────────────────────────────
const state = {
  history: [],
  chatMessages: [],
  lastContext: "",
  stats: { total:0, positive:0, negative:0, neutral:0, topics:{} }
};

try { state.history = JSON.parse(localStorage.getItem("op_history") || "[]"); } catch(e){}

// ── Helpers ───────────────────────────────────────────────────
const el = (id) => document.getElementById(id);

function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function toast(msg, type) {
  const t = el("toast");
  t.textContent = msg;
  t.className = "toast show " + (type || "");
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = "toast"; }, 3200);
}

function setBtn(btnId, spinnerId, loading) {
  const btn = el(btnId);
  const sp  = el(spinnerId);
  if (!btn) return;
  btn.disabled = loading;
  if (sp) sp.style.display = loading ? "inline-block" : "none";
}

// ── Boot ──────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", function() {
  rebuildStats();
  renderDashboard();
  renderHistory();

  // Nav tabs
  document.querySelectorAll(".nav-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      document.querySelectorAll(".nav-btn").forEach(function(b){ b.classList.remove("active"); });
      document.querySelectorAll(".panel").forEach(function(p){ p.classList.remove("active"); });
      btn.classList.add("active");
      el("section-" + btn.dataset.section).classList.add("active");
    });
  });

  // Analyze
  el("analyzeBtn").addEventListener("click", handleAnalyze);
  el("clearBtn").addEventListener("click", function() {
    el("opinionInput").value = "";
    el("charCount").textContent = "0 / 2000";
  });
  el("opinionInput").addEventListener("input", function() {
    el("charCount").textContent = this.value.length + " / 2000";
  });

  // Compare
  el("compareBtn").addEventListener("click", handleCompare);

  // Bulk
  el("bulkBtn").addEventListener("click", handleBulk);

  // History
  el("clearHistoryBtn").addEventListener("click", clearHistory);

  // Sample
  el("loadSampleBtn").addEventListener("click", loadSample);

  // Chat
  el("chatbotFab").addEventListener("click", toggleChat);
  el("chatbotClose").addEventListener("click", toggleChat);
  el("chatSendBtn").addEventListener("click", sendChat);
  el("chatInput").addEventListener("keydown", function(e) {
    if (e.key === "Enter") sendChat();
  });
});

// ── ANALYZE ───────────────────────────────────────────────────
async function handleAnalyze() {
  const text = el("opinionInput").value.trim();
  if (!text) { toast("Please enter an opinion first", "error"); return; }

  setBtn("analyzeBtn", "analyzeSpinner", true);
  try {
    const res  = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "API error");
    renderResult(data.result, text);
    saveHistory(text, data.result);
    updateStats(data.result);
    toast("Analysis complete ✓", "success");
  } catch(err) {
    toast("Error: " + err.message, "error");
    console.error(err);
  } finally {
    setBtn("analyzeBtn", "analyzeSpinner", false);
  }
}

function renderResult(r, text) {
  const card = el("resultCard");
  card.style.display = "block";

  // Badge
  const badge = el("sentimentBadge");
  badge.textContent = r.sentiment || "Neutral";
  badge.className = "sent-badge " + (r.sentiment || "Neutral");

  // Score arc
  const score = Math.max(0, Math.min(100, r.score || 50));
  el("scoreNum").textContent = score;
  const circ = 138.23;
  setTimeout(function() {
    el("scoreArc").style.strokeDashoffset = circ - (score / 100) * circ;
    el("scoreArc").style.transition = "stroke-dashoffset 1s ease";
  }, 60);

  // Text
  el("resultReason").textContent         = r.reason         || "—";
  el("resultInsight").textContent        = r.insight        || "—";
  el("resultRecommendation").textContent = r.recommendation || "—";

  // Topics
  el("resultTopics").innerHTML = (r.topics || [])
    .map(function(t){ return '<span class="tag accent">' + esc(t) + '</span>'; }).join("");

  // Emotions
  el("resultEmotions").innerHTML = (r.emotions || [])
    .map(function(e){ return '<span class="tag pink">' + esc(e) + '</span>'; }).join("");

  // Trend
  const trend = r.trend || "Stable";
  const arrow = { Rising:"↑", Falling:"↓", Stable:"→" }[trend] || "→";
  el("resultTrend").textContent = arrow + " " + trend;
  el("resultTrend").className   = "trend-badge " + trend;

  // Context for chatbot
  state.lastContext = 'Last analyzed: "' + text.slice(0,200) + '"\nSentiment: ' + r.sentiment + '\nTopics: ' + (r.topics||[]).join(", ") + '\nInsight: ' + r.insight;

  card.scrollIntoView({ behavior:"smooth", block:"nearest" });
}

// ── COMPARE ───────────────────────────────────────────────────
async function handleCompare() {
  const a = el("topicA").value.trim();
  const b = el("topicB").value.trim();
  if (!a || !b) { toast("Enter both topics", "error"); return; }

  setBtn("compareBtn", "compareSpinner", true);
  try {
    const res  = await fetch("/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicA: a, topicB: b })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "API error");
    renderCompare(data.result, a, b);
    toast("Comparison ready ✓", "success");
  } catch(err) {
    toast("Error: " + err.message, "error");
  } finally {
    setBtn("compareBtn", "compareSpinner", false);
  }
}

function renderCompare(r, la, lb) {
  el("compareResult").style.display = "block";

  const sc = { Positive:"#4ade80", Negative:"#f87171", Neutral:"#94a3b8" };

  function buildSide(data, label, id) {
    const col = sc[data.sentiment] || "#94a3b8";
    el(id).innerHTML =
      '<div class="cc-lbl">' + esc(label) + '</div>' +
      '<div class="cc-sent" style="color:' + col + '">' + (data.sentiment||"—") + '</div>' +
      '<div class="cc-score" style="color:' + col + '">' + (data.score||0) + '</div>' +
      '<div class="cc-sum">' + esc(data.summary||"") + '</div>';
  }
  buildSide(r.topicA, la, "compareCardA");
  buildSide(r.topicB, lb, "compareCardB");

  const winName = r.winner === "A" ? la : r.winner === "B" ? lb : "Tie";
  el("compareWinner").innerHTML =
    '<span class="w-emoji">🏆</span>' +
    '<div class="w-lbl">More Positive</div>' +
    '<div class="w-name">' + esc(r.winnerLabel || winName) + '</div>';

  el("compareDiffs").innerHTML = (r.keyDifferences || [])
    .map(function(d){ return "<li>" + esc(d) + "</li>"; }).join("");
  el("compareInsight").textContent = r.comparison || "—";

  el("compareResult").scrollIntoView({ behavior:"smooth", block:"nearest" });
}

// ── BULK ──────────────────────────────────────────────────────
async function handleBulk() {
  const raw = el("bulkInput").value.trim();
  if (!raw) { toast("Enter at least one opinion", "error"); return; }
  const opinions = raw.split("\n").map(function(l){ return l.trim(); }).filter(Boolean);
  if (opinions.length < 2) { toast("Enter at least 2 opinions (one per line)", "error"); return; }

  setBtn("bulkBtn", "bulkSpinner", true);
  try {
    const res  = await fetch("/api/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opinions })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "API error");
    renderBulk(data.result, opinions);
    toast(opinions.length + " opinions analyzed ✓", "success");
  } catch(err) {
    toast("Error: " + err.message, "error");
  } finally {
    setBtn("bulkBtn", "bulkSpinner", false);
  }
}

function renderBulk(r, opinions) {
  el("bulkResult").style.display = "block";
  const sc2 = { Positive:"#4ade80", Negative:"#f87171", Neutral:"#94a3b8", Mixed:"#a78bfa" };
  const os  = r.overall_sentiment || "Mixed";
  const col = sc2[os] || "#94a3b8";
  el("bulkSentiment").innerHTML = '<span style="color:' + col + '">' + esc(os) + '</span> Overall';
  const d = r.distribution || {};
  el("bulkDist").innerHTML =
    '<span class="bulk-pill" style="background:rgba(74,222,128,.1);color:#4ade80">' + (d.positive||0) + '% Pos</span>' +
    '<span class="bulk-pill" style="background:rgba(148,163,184,.1);color:#94a3b8">' + (d.neutral||0) + '% Neu</span>' +
    '<span class="bulk-pill" style="background:rgba(248,113,113,.1);color:#f87171">' + (d.negative||0) + '% Neg</span>';
  el("bulkInsight").textContent = r.collective_insight || "—";
  el("bulkTopics").innerHTML = (r.top_topics || [])
    .map(function(t){ return '<span class="tag accent">' + esc(t) + '</span>'; }).join("");

  const ind = r.individual || [];
  el("bulkItems").innerHTML = opinions.map(function(op, i) {
    const item = ind.find(function(x){ return x.index === i; }) || {};
    const s3   = item.sentiment || "Neutral";
    const c3   = sc2[s3] || "#94a3b8";
    return '<div class="bulk-item">' +
      '<div class="bulk-num">#' + (i+1) + '</div>' +
      '<div class="bulk-text">' + esc(op) + '</div>' +
      '<div class="bulk-badge" style="background:' + c3 + '20;color:' + c3 + '">' + s3 + '</div>' +
      '</div>';
  }).join("");

  el("bulkResult").scrollIntoView({ behavior:"smooth", block:"nearest" });
}

// ── STATS / DASHBOARD ─────────────────────────────────────────
function rebuildStats() {
  const s = state.stats;
  s.total    = state.history.length;
  s.positive = state.history.filter(function(e){ return e.result && e.result.sentiment === "Positive"; }).length;
  s.negative = state.history.filter(function(e){ return e.result && e.result.sentiment === "Negative"; }).length;
  s.neutral  = state.history.filter(function(e){ return e.result && e.result.sentiment === "Neutral";  }).length;
  s.topics   = {};
  state.history.forEach(function(e) {
    (e.result && e.result.topics || []).forEach(function(t) {
      s.topics[t] = (s.topics[t] || 0) + 1;
    });
  });
}

function updateStats(result) {
  const s = state.stats;
  s.total++;
  if (result.sentiment === "Positive") s.positive++;
  else if (result.sentiment === "Negative") s.negative++;
  else s.neutral++;
  (result.topics || []).forEach(function(t) { s.topics[t] = (s.topics[t]||0)+1; });
  renderDashboard(result.sentiment);
}

function renderDashboard(lastSentiment) {
  const s  = state.stats;
  const pct = function(n){ return s.total ? Math.round(n/s.total*100) : 0; };
  const pp = pct(s.positive), np = pct(s.negative), nup = pct(s.neutral);

  el("totalOpinions").textContent = s.total;
  el("posPercent").textContent    = pp + "%";
  el("negPercent").textContent    = np + "%";
  el("neuPercent").textContent    = nup + "%";
  el("barPos").style.width        = pp + "%";
  el("barNeu").style.width        = nup + "%";
  el("barNeg").style.width        = np + "%";

  // Topics
  const cloud = el("topicCloud");
  const topEntries = Object.entries(s.topics).sort(function(a,b){ return b[1]-a[1]; }).slice(0,12);
  if (topEntries.length) {
    cloud.innerHTML = topEntries.map(function(e){ return '<span class="topic-tag">' + esc(e[0]) + '</span>'; }).join("");
  } else {
    cloud.innerHTML = '<span class="muted-hint">Analyze to see topics</span>';
  }

  // Mood
  const ring = el("moodRing");
  ring.className = "mood-ring";
  if (lastSentiment === "Positive" || (s.total > 0 && pp >= np)) {
    ring.classList.add("m-pos");
    el("moodEmoji").textContent = "😊";
    el("moodLabel").textContent = "Positive";
  } else if (lastSentiment === "Negative" || (s.total > 0 && np > pp)) {
    ring.classList.add("m-neg");
    el("moodEmoji").textContent = "😟";
    el("moodLabel").textContent = "Negative";
  } else if (s.total > 0) {
    el("moodEmoji").textContent = "😐";
    el("moodLabel").textContent = "Neutral";
  }
}

// ── HISTORY ───────────────────────────────────────────────────
function saveHistory(text, result) {
  const entry = { id: Date.now(), text: text.slice(0,300), result: result, date: new Date().toISOString() };
  state.history.unshift(entry);
  if (state.history.length > 50) state.history = state.history.slice(0,50);
  try { localStorage.setItem("op_history", JSON.stringify(state.history)); } catch(e){}
  renderHistory();
}

function renderHistory() {
  el("historyCount").textContent = state.history.length + " record" + (state.history.length !== 1 ? "s" : "");
  const list = el("historyList");
  if (!state.history.length) {
    list.innerHTML = '<div class="empty-state"><div style="font-size:48px;margin-bottom:12px">🔍</div><p>No history yet. Start analyzing!</p></div>';
    return;
  }
  list.innerHTML = state.history.map(function(e) {
    const s   = (e.result && e.result.sentiment || "Neutral").toLowerCase();
    const topics = (e.result && e.result.topics || []).slice(0,3);
    const date = new Date(e.date).toLocaleDateString("en-US",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
    return '<div class="history-item ' + s + '" onclick="loadHistoryItem(' + e.id + ')">' +
      '<div class="hi-header">' +
        '<span class="hi-sent ' + s + '">' + esc(e.result && e.result.sentiment || "Unknown") + ' · ' + (e.result && e.result.score || 0) + '</span>' +
        '<span class="hi-date">' + date + '</span>' +
      '</div>' +
      '<div class="hi-text">' + esc(e.text) + '</div>' +
      '<div class="hi-tags">' + topics.map(function(t){ return '<span class="hi-tag">' + esc(t) + '</span>'; }).join("") + '</div>' +
      '</div>';
  }).join("");
}

function loadHistoryItem(id) {
  const entry = state.history.find(function(e){ return e.id === id; });
  if (!entry) return;
  el("opinionInput").value = entry.text;
  el("charCount").textContent = entry.text.length + " / 2000";
  renderResult(entry.result, entry.text);
  document.querySelector('[data-section="analyze"]').click();
  toast("History item loaded", "success");
}

function clearHistory() {
  if (!state.history.length) return;
  if (!confirm("Clear all history?")) return;
  state.history = [];
  try { localStorage.removeItem("op_history"); } catch(e){}
  state.stats = { total:0, positive:0, negative:0, neutral:0, topics:{} };
  renderDashboard();
  renderHistory();
  toast("History cleared");
}

// ── SAMPLE ────────────────────────────────────────────────────
const SAMPLES = [
  "The new climate change policy is finally a step in the right direction. Renewable energy investment is booming and it gives me hope for the future.",
  "Inflation is destroying middle-class families. The cost of groceries, rent, and healthcare has become completely unaffordable for ordinary people.",
  "The latest smartphone release is underwhelming. Same features recycled with a higher price tag — consumers deserve better innovation.",
  "The education system needs major reform. Teachers are underpaid, classrooms are overcrowded, and students are disengaged.",
  "The new public transportation system in our city is fantastic! It reduced my commute by half and is great for the environment."
];

function loadSample() {
  const s = SAMPLES[Math.floor(Math.random() * SAMPLES.length)];
  el("opinionInput").value = s;
  el("charCount").textContent = s.length + " / 2000";
  document.querySelector('[data-section="analyze"]').click();
  toast("Sample loaded — click Analyze!", "success");
}

// ── CHATBOT ───────────────────────────────────────────────────
function toggleChat() {
  const panel = el("chatbotPanel");
  const badge = el("fabBadge");
  panel.classList.toggle("open");
  badge.style.display = "none";
  if (panel.classList.contains("open")) {
    setTimeout(function(){ el("chatInput").focus(); }, 300);
  }
}

async function sendChat() {
  const input = el("chatInput");
  const text  = input.value.trim();
  if (!text) return;
  input.value = "";

  addMsg(text, "user");
  state.chatMessages.push({ role: "user", content: text });
  if (state.chatMessages.length > 10) state.chatMessages = state.chatMessages.slice(-10);

  showTyping();
  try {
    const res  = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: state.chatMessages, context: state.lastContext })
    });
    const data = await res.json();
    removeTyping();
    const reply = data.success ? data.reply : "Sorry, I hit an error: " + (data.error || "unknown");
    addMsg(reply, "bot");
    state.chatMessages.push({ role: "assistant", content: reply });
    if (!el("chatbotPanel").classList.contains("open")) {
      el("fabBadge").style.display = "block";
    }
  } catch(err) {
    removeTyping();
    addMsg("Network error. Please try again.", "bot");
  }
}

function addMsg(text, who) {
  const msgs = el("chatMessages");
  const div  = document.createElement("div");
  div.className = "cmsg " + who;
  div.innerHTML = '<div class="cbubble">' + esc(text) + '</div>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function showTyping() {
  const msgs = el("chatMessages");
  const div  = document.createElement("div");
  div.className = "cmsg bot typing";
  div.id = "typingDot";
  div.innerHTML = '<div class="cbubble"><span class="tdot"></span><span class="tdot"></span><span class="tdot"></span></div>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function removeTyping() {
  const t = el("typingDot");
  if (t) t.remove();
}