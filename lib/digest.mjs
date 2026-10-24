import nodemailer from "nodemailer";

const TZ = "Africa/Lagos";
const PROFILES = {
  emmanuel: {
    name: "Emmanuel",
    tone: "personal",
    title: "Your Finance Brief",
    intro: "The money and policy stories worth your attention today.",
    query: '(finance OR markets OR economy OR inflation OR "Federal Reserve" OR FOMC OR "consumer price index" OR CPI OR "nonfarm payrolls" OR NFP OR "Bank of England" OR "Central Bank of Nigeria" OR naira OR bonds OR stocks)',
    max: 12,
  },
  wisdom: {
    name: "Wisdom",
    tone: "professional",
    title: "Business, Leadership & Opportunity Brief",
    intro: "A concise review of developments across Nigeria, Africa and technology, selected for their practical relevance.",
    query: '(Nigeria OR Nigerian OR Africa) AND (business OR economy OR startup OR entrepreneurship OR leadership OR technology OR AI OR education OR scholarship OR engineering OR manufacturing OR energy OR policy OR government)',
    opportunities: '(grant OR grants OR scholarship OR scholarships OR fellowship OR fellowships OR accelerator OR competition OR "youth programme" OR "youth program" OR funding opportunity) AND (Nigeria OR Africa OR African OR students OR entrepreneurs)',
    max: 16,
  },
  joshua: {
    name: "Joshua",
    tone: "friendly",
    title: "Your Daily Brief",
    intro: "Here’s the useful stuff to keep on your radar today: money, business, tech and opportunities.",
    query: '(finance OR markets OR economy OR inflation OR FOMC OR CPI OR NFP OR Nigeria OR African business OR startups OR entrepreneurship OR technology OR AI OR energy)',
    opportunities: '(grant OR scholarship OR fellowship OR accelerator OR competition OR "youth programme" OR "youth program") AND (Nigeria OR Africa OR students OR entrepreneurs)',
    max: 14,
  },
  zainab: {
    name: "Zainab",
    tone: "curated",
    title: "Zainab’s Curated Finance Edition",
    intro: "A carefully edited evening read: the financial developments that matter, why they matter, and what to watch next.",
    query: '(finance OR markets OR economy OR inflation OR "Federal Reserve" OR FOMC OR "consumer price index" OR CPI OR "nonfarm payrolls" OR NFP OR naira OR "Central Bank of Nigeria" OR bonds OR stocks)',
    max: 10,
  },
};

function env(name) {
  return process.env[name];
}

function lagosDate() {
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function normalizedArticle(article) {
  if (!article?.title || !article?.url || !/^https?:\/\//i.test(article.url)) return null;
  return {
    title: article.title,
    description: article.description || "",
    url: article.url,
    source: article.source || "News source",
    publishedAt: article.publishedAt || "",
  };
}

async function fetchProvider(name, query) {
  const encoded = encodeURIComponent(query);
  if (name === "newsapi") {
    const key = env("NEWSAPI_KEY");
    if (!key) return [];
    const url = `https://newsapi.org/v2/everything?q=${encoded}&language=en&sortBy=publishedAt&pageSize=30&apiKey=${encodeURIComponent(key)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!response.ok) throw new Error(`NewsAPI returned ${response.status}`);
    const body = await response.json();
    return (body.articles || []).map((article) => normalizedArticle({
      title: article.title,
      description: article.description,
      url: article.url,
      source: article.source?.name,
      publishedAt: article.publishedAt,
    })).filter(Boolean);
  }
  if (name === "gnews") {
    const key = env("GNEWS_API_KEY");
    if (!key) return [];
    const url = `https://gnews.io/api/v4/search?q=${encoded}&lang=en&max=10&apikey=${encodeURIComponent(key)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!response.ok) throw new Error(`GNews returned ${response.status}`);
    const body = await response.json();
    return (body.articles || []).map((article) => normalizedArticle({
      title: article.title,
      description: article.description,
      url: article.url,
      source: article.source?.name,
      publishedAt: article.publishedAt,
    })).filter(Boolean);
  }
  const key = env("GUARDIAN_API_KEY");
  if (!key) return [];
  const url = `https://content.guardianapis.com/search?q=${encoded}&show-fields=trailText&page-size=30&order-by=newest&api-key=${encodeURIComponent(key)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw new Error(`The Guardian returned ${response.status}`);
  const body = await response.json();
  return (body.response?.results || []).map((article) => normalizedArticle({
    title: article.webTitle,
    description: article.fields?.trailText?.replace(/<[^>]*>/g, ""),
    url: article.webUrl,
    source: "The Guardian",
    publishedAt: article.webPublicationDate,
  })).filter(Boolean);
}

async function searchNews(query) {
  const configured = ["newsapi", "gnews", "guardian"].filter((name) => ({
    newsapi: env("NEWSAPI_KEY"), gnews: env("GNEWS_API_KEY"), guardian: env("GUARDIAN_API_KEY"),
  })[name]);
  if (!configured.length) throw new Error("No news provider configured. Add NEWSAPI_KEY, GNEWS_API_KEY, or GUARDIAN_API_KEY.");
  const results = await Promise.allSettled(configured.map((name) => fetchProvider(name, query)));
  const failed = results.filter((result) => result.status === "rejected");
  const articles = results.filter((result) => result.status === "fulfilled").flatMap((result) => result.value);
  if (!articles.length && failed.length === results.length) throw new Error("All configured news providers failed.");
  const seen = new Set();
  return articles
    .filter((article) => {
      const key = article.url.toLowerCase().replace(/\/$/, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
}

function articleHtml(article) {
  const date = article.publishedAt ? new Date(article.publishedAt) : null;
  const when = date && !Number.isNaN(date.valueOf())
    ? new Intl.DateTimeFormat("en-NG", { timeZone: TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date)
    : "";
  return `<article style="padding:18px 0;border-bottom:1px solid #e7e5e4"><div style="font:600 11px Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#7c6a4a">${escapeHtml(article.source)}${when ? ` · ${escapeHtml(when)}` : ""}</div><h3 style="margin:7px 0;font:700 18px Georgia,serif;line-height:1.35"><a href="${escapeHtml(article.url)}" style="color:#1c2622;text-decoration:none">${escapeHtml(article.title)}</a></h3>${article.description ? `<p style="margin:0;color:#525b56;font:14px/1.6 Arial,sans-serif">${escapeHtml(article.description)}</p>` : ""}<p style="margin:10px 0 0"><a href="${escapeHtml(article.url)}" style="font:600 12px Arial,sans-serif;color:#746044">Read the full story →</a></p></article>`;
}

function sectionHtml(title, articles, emptyText) {
  const content = articles.length ? articles.map(articleHtml).join("") : `<p style="color:#646b66;font:14px/1.6 Arial,sans-serif">${escapeHtml(emptyText)}</p>`;
  return `<h2 style="margin:26px 0 2px;font:700 21px Georgia,serif;color:#1c2622">${escapeHtml(title)}</h2>${content}`;
}

function bodyText(profile, main, opportunities) {
  const lines = [profile.intro, "", "TODAY’S STORIES", ...main.flatMap((article) => [
    `${article.title} — ${article.source}`,
    article.description,
    article.url,
    "",
  ])];
  if (profile.opportunities) {
    lines.push("OPPORTUNITIES", "");
    if (opportunities.length) {
      for (const article of opportunities) lines.push(`${article.title} — ${article.source}`, article.description, article.url, "");
    } else lines.push("No clearly relevant opportunities were found in today’s feed.", "");
  }
  lines.push("Curated from the news sources configured for this edition.");
  return lines.filter((line) => line !== undefined).join("\n");
}

function message(profile, main, opportunities = []) {
  const greeting = profile.tone === "friendly"
    ? "Morning, Josh—here’s what matters today."
    : profile.tone === "personal"
      ? `Good morning, ${profile.name}.`
      : profile.tone === "curated"
        ? `Good evening, ${profile.name}.`
        : `Good morning, ${profile.name}.`;
  const opportunitiesSection = profile.opportunities
    ? sectionHtml("Opportunities", opportunities, "No clearly relevant grants, scholarships, fellowships or programmes surfaced today.")
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f3f1ec"><div style="max-width:680px;margin:0 auto;padding:24px 14px"><header style="padding:23px 24px;background:#20332d;color:#fff"><div style="font:600 11px Arial,sans-serif;letter-spacing:.16em;color:#d4bf96">MERIDIAN · DAILY BRIEF</div><h1 style="margin:12px 0 4px;font:700 30px Georgia,serif">${escapeHtml(profile.title)}</h1><div style="font:13px Arial,sans-serif;color:#d7ddd8">${escapeHtml(lagosDate())}</div></header><main style="padding:24px;background:#fff"><p style="font:15px/1.6 Arial,sans-serif;color:#27312c">${escapeHtml(greeting)}<br>${escapeHtml(profile.intro)}</p>${sectionHtml("The stories", main, "No matching stories were returned by the configured news feeds today.")}${opportunitiesSection}<p style="margin:28px 0 0;padding-top:15px;border-top:1px solid #e7e5e4;color:#7c827e;font:12px/1.5 Arial,sans-serif">Meridian Daily News · Links go directly to the original publishers.</p></main></div></body></html>`;
  return { html, text: bodyText(profile, main, opportunities) };
}

async function deliver(profileKey, recipient, isEvening = false) {
  const profile = PROFILES[profileKey];
  if (!profile || !recipient) throw new Error(`Missing profile or recipient for ${profileKey}`);
  const mainQuery = await searchNews(profile.query);
  const opportunities = profile.opportunities ? await searchNews(profile.opportunities) : [];
  const payload = message(profile, mainQuery.slice(0, profile.max), opportunities.slice(0, 10));
  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  if (!host || !user || !pass) throw new Error("SMTP_HOST, SMTP_USER, and SMTP_PASS must be configured.");
  const port = Number(env("SMTP_PORT") || 587);
  const mailer = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  await mailer.sendMail({
    from: env("SMTP_FROM") || `Meridian Daily News <${user}>`,
    to: recipient,
    subject: `${isEvening ? "Evening" : "Morning"}: ${profile.title} · ${lagosDate()}`,
    text: payload.text,
    html: payload.html,
  });
  console.log(`Sent ${profileKey} digest to ${recipient}`);
}

export async function sendMorningDigests() {
  const recipients = [
    ["emmanuel", env("EMMANUEL_EMAIL")],
    ["wisdom", env("WISDOM_EMAIL")],
    ["joshua", env("JOSHUA_EMAIL")],
  ];
  const missing = recipients.filter(([, email]) => !email).map(([key]) => key);
  if (missing.length) throw new Error(`Missing recipient email setting(s): ${missing.join(", ")}.`);
  const results = await Promise.allSettled(recipients.map(([key, email]) => deliver(key, email)));
  const failures = results.filter((result) => result.status === "rejected");
  failures.forEach((failure) => console.error("Morning digest failed:", failure.reason));
  if (failures.length) throw new Error(`${failures.length} morning digest(s) failed; see function logs.`);
}

export async function sendZainabDigest() {
  const recipient = env("ZAINAB_EMAIL");
  if (!recipient) throw new Error("ZAINAB_EMAIL must be set before the 7 PM digest can be delivered.");
  await deliver("zainab", recipient, true);
}
