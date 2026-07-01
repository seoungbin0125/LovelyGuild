import { writeFile } from "node:fs/promises";

const MODES = [
  ["league", "대항전"],
  ["training", "수련장"],
  ["boss", "보스대전"]
];

const DEFAULT_GUILDS = "LOVELY";
const guilds = (process.env.GUILD_CONTENT_NAMES || DEFAULT_GUILDS)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const output = process.env.GUILD_CONTENT_OUTPUT || "data/guild-contents.json";

const result = {
  capturedAt: todayKst(),
  source: "MGF.GG",
  guilds: []
};

for (const keyword of guilds) {
  const bundle = { keyword, modes: {} };
  for (const [mode, label] of MODES) {
    const url = makeUrl(mode, keyword);
    try {
      const html = await fetchText(url);
      const parsed = parseGuildContentPage(html);
      bundle.modes[mode] = {
        label,
        url,
        matchCount: parsed.matchCount,
        guilds: parsed.guilds
      };
      console.log(`[${label}] ${keyword}: ${parsed.guilds.length}개 길드`);
    } catch (error) {
      console.warn(`[${label}] ${keyword}: 수집 실패 - ${error.message}`);
      bundle.modes[mode] = { label, url, matchCount: 0, guilds: [] };
    }
  }
  result.guilds.push(bundle);
}

await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`${output} 저장 완료`);

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 guild-dashboard-content-collector"
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function parseGuildContentPage(html) {
  const text = htmlToText(html);
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const matchLine = lines.find((line) => /총\s*\d+개\s*길드/.test(line)) || "";
  const matchCount = Number((matchLine.match(/총\s*(\d+)개\s*길드/) || [])[1] || 0);
  const guilds = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (!/^Master\./.test(lines[i + 1] || "")) continue;
    const name = cleanGuildName(lines[i]);
    const master = (lines[i + 1] || "").replace(/^Master\.\s*/, "").trim();
    const server = lines[i + 2] || "";
    const powerText = lines[i + 3] || "";
    const members = [];

    for (let j = i + 4; j < Math.min(lines.length, i + 24); j += 1) {
      const line = lines[j];
      const member = parseMemberLine(line);
      if (member) members.push(member);
      if (members.length >= 5) break;
    }

    if (name && master && server) {
      guilds.push({ name, master, server, powerText, members });
    }
  }

  return { matchCount: matchCount || guilds.length, guilds };
}

function parseMemberLine(line) {
  const match = String(line || "").match(/^(\d+)\s+(.+?)\s+([\d,]+(?:\.\d+)?(?:\s*[경조억만]\s*[\d,]*(?:\.\d+)?)*\s*[경조억만]?)$/);
  if (!match) return null;
  return {
    rank: Number(match[1]),
    nickname: match[2].trim(),
    powerText: match[3].replace(/\s+/g, " ").trim()
  };
}

function cleanGuildName(value) {
  return String(value || "")
    .replace(/^#+\s*/, "")
    .replace(/길드 상세보기.*$/, "")
    .trim();
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/div>|<\/li>|<\/h\d>|<\/section>|<\/article>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{2,}/g, "\n");
}

function makeUrl(mode, keyword) {
  return `https://mgf.gg/contents/guild.php?mode=${encodeURIComponent(mode)}&stx=${encodeURIComponent(keyword)}`;
}

function todayKst() {
  const now = new Date();
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
