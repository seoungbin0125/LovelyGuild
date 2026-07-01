const ENV = globalThis.process?.env || {};
const SOURCE_BASE = ENV.SOURCE_BASE || `https://${["m", "g", "f"].join("")}.gg`;
const DEFAULT_SERVER_ID = ENV.SERVER_ID || "4";
const DEFAULT_MAX_PAGE = Number(ENV.TOBEOL_MAX_PAGE || 20);
const DEFAULT_MEMBER_LIMIT = Number(ENV.MEMBER_LIMIT || 120);

export async function fetchLiveTobeolByGuild({ guildName, serverId = "", maxPage = DEFAULT_MAX_PAGE, memberLimit = DEFAULT_MEMBER_LIMIT } = {}) {
  const guild = String(guildName || "").trim();
  if (!guild) throw new Error("길드명을 입력해주세요.");

  const sourceUrl = guildInfoUrl(guild);
  const guildHtml = await fetchHtml(sourceUrl);
  const guildText = htmlToText(guildHtml);
  const guildInfo = parseGuildInfo(guildText, guild);
  const resolvedServerId = String(serverId || guildInfo.serverId || DEFAULT_SERVER_ID || "4").trim();

  const members = parseGuildMembersFromText(guildText)
    .slice(0, memberLimit)
    .map((member) => ({ ...member, guild, memberKey: memberKey(guild, member.nickname) }));

  if (!members.length) {
    throw new Error(`${guild} 길드원 목록을 찾지 못했습니다. MGF 길드명을 확인해주세요.`);
  }

  const tobeolRows = await fetchTobeolRows({ serverId: resolvedServerId, maxPage });
  const scoreMap = new Map();
  for (const row of tobeolRows) {
    if (!scoreMap.has(row.nickname) || row.scoreValue > scoreMap.get(row.nickname).scoreValue) {
      scoreMap.set(row.nickname, row);
    }
  }

  const mergedMembers = members.map((member) => {
    const score = scoreMap.get(member.nickname) || null;
    const scoreValue = Number(score?.scoreValue || 0);
    return {
      rank: member.rank,
      guild,
      nickname: member.nickname,
      job: member.job,
      level: member.level,
      powerValue: member.powerValue,
      powerText: member.powerText || formatKoreanPower(member.powerValue),
      tobeolRank: score?.rank ?? null,
      tobeolValue: scoreValue,
      tobeolText: scoreValue > 0 ? (normalizeKoreanPowerText(score.scoreText) || formatKoreanPower(scoreValue)) : "0",
      hit: scoreValue > 0
    };
  });

  const hitMembers = mergedMembers.filter((member) => member.hit);
  const missedMembers = mergedMembers.filter((member) => !member.hit);
  const totalTobeolValue = mergedMembers.reduce((sum, member) => sum + Number(member.tobeolValue || 0), 0);

  return {
    ok: true,
    guild,
    source: "MGF live guild_info + guild_boss",
    sourceUrl,
    bossUrl: `${SOURCE_BASE}/ranking/guild_boss.php?server=${encodeURIComponent(resolvedServerId)}&job=&page=1`,
    serverId: resolvedServerId,
    serverName: guildInfo.serverName || "",
    capturedAt: kstDateTimeString(),
    maxPage,
    summary: {
      memberCount: mergedMembers.length,
      hitCount: hitMembers.length,
      missedCount: missedMembers.length,
      hitRate: mergedMembers.length ? Number(((hitMembers.length / mergedMembers.length) * 100).toFixed(1)) : 0,
      totalTobeolValue,
      totalTobeolText: formatKoreanPower(totalTobeolValue)
    },
    members: mergedMembers,
    hitMembers: [...hitMembers].sort((a, b) => Number(b.tobeolValue || 0) - Number(a.tobeolValue || 0)),
    missedMembers
  };
}

async function fetchTobeolRows({ serverId, maxPage }) {
  const rows = [];
  for (let page = 1; page <= Number(maxPage || DEFAULT_MAX_PAGE); page += 1) {
    const url = `${SOURCE_BASE}/ranking/guild_boss.php?server=${encodeURIComponent(serverId || DEFAULT_SERVER_ID)}&job=&page=${page}`;
    const html = await fetchHtml(url);
    rows.push(...parseTobeolRowsFromText(htmlToText(html)));
    await sleep(180);
  }
  return rows;
}

function parseGuildInfo(textContent, guildName) {
  const text = cleanText(textContent);
  const escaped = escapeRegex(guildName);
  const exact = text.match(new RegExp(`${escaped}\\s+([A-Za-z가-힣]+)\\s+(\\d+)\\s+레벨`, "i"));
  const fallback = text.match(/([A-Za-z가-힣]+)\s+(\d+)\s+레벨\s+Lv\./);
  return {
    serverName: exact?.[1] || fallback?.[1] || "",
    serverId: exact?.[2] || fallback?.[2] || ""
  };
}

function parseGuildMembersFromText(textContent) {
  const start = textContent.indexOf("Guild Members");
  const end = textContent.indexOf("서비스 이용약관");

  let section = start >= 0
    ? textContent.slice(start, end > start ? end : undefined)
    : textContent;

  section = section
    .replace(/\s+/g, " ")
    .replace(/닉네임 전투력/g, " ")
    .trim();

  const members = [];
  const seen = new Set();
  const blockRegex = /(?:^|\s)(\d{1,3})\s+([\s\S]*?)(?=\s+\d{1,3}\s+\S+|$)/g;
  let match;

  while ((match = blockRegex.exec(section)) !== null) {
    const rank = Number(match[1]);
    const block = cleanText(match[2]);

    if (!block.includes("Lv.")) continue;

    const jobLevelMatch = block.match(/([가-힣A-Za-z(),]+(?:\([^)]+\))?)\s*\|\s*Lv\.?\s*(\d+)/);
    if (!jobLevelMatch) continue;

    const job = cleanText(jobLevelMatch[1]);
    const level = Number(jobLevelMatch[2]);

    const beforeTokens = cleanText(block.slice(0, jobLevelMatch.index))
      .split(/\s+/)
      .filter(Boolean);

    const nickname = beforeTokens
      .filter((value) => value !== "마스터")
      .filter((value) => value !== job)
      .find((value) => !value.startsWith("♥") && value !== "Image:" && value !== "loading") || "";

    if (!nickname || seen.has(nickname)) continue;

    const afterJob = block.slice(jobLevelMatch.index + jobLevelMatch[0].length);
    const powerCandidates = [...afterJob.matchAll(
      /((?:[\d,]+(?:\.\d+)?\s*경\s*)?(?:[\d,]+(?:\.\d+)?\s*조\s*)*(?:[\d,]+(?:\.\d+)?\s*억\s*)*(?:[\d,]+(?:\.\d+)?\s*만\s*)?)/g
    )]
      .map((item) => item[1])
      .map((value) => ({
        text: value,
        value: parseKoreanPowerValue(value)
      }))
      .filter((item) => item.value > 0);

    if (powerCandidates.length === 0) continue;

    const power = powerCandidates[powerCandidates.length - 1];
    seen.add(nickname);

    members.push({
      rank,
      nickname,
      job,
      level,
      powerValue: power.value,
      powerText: normalizeKoreanPowerText(power.text) || power.text
    });
  }

  return members;
}

function parseTobeolRowsFromText(textContent) {
  const source = cleanText(textContent);
  const rows = [];
  const blockRegex = /(?:^|\s)(\d{1,4})\s+S\d+\s+([\s\S]*?)(?=\s+\d{1,4}\s+S\d+\s+|$)/g;
  let match;

  while ((match = blockRegex.exec(source)) !== null) {
    const rank = Number(match[1]);
    const block = cleanText(match[2]);
    const jobLevelMatch = block.match(/Lv\.?\s*(\d+)\s*\|\s*([가-힣A-Za-z(),]+(?:\([^)]+\))?)/);
    if (!jobLevelMatch) continue;

    const beforeLevel = cleanText(block.slice(0, jobLevelMatch.index));
    const tokens = beforeLevel.split(/\s+/).filter(Boolean);
    const nickname = tokens.find((token) => {
      if (!token) return false;
      if (["Image:", "loading", "V", "I", "P", "VIP", "VVIP"].includes(token)) return false;
      if (token.includes("|")) return false;
      if (token.startsWith("♥")) return false;
      return /[가-힣A-Za-z0-9]/.test(token);
    });
    if (!nickname) continue;

    const scoreCandidates = [...block.matchAll(
      /((?:[\d,.]+\s*경\s*)?(?:[\d,.]+\s*조\s*)?(?:[\d,.]+\s*억\s*)?(?:[\d,.]+\s*만\s*)+|\d+(?:,\d{3})+)/g
    )]
      .map((item) => item[1])
      .filter((value) => /[조억만경]/.test(value))
      .map((value) => ({ text: value, value: parseKoreanPowerValue(value) }))
      .filter((item) => item.value > 0);

    if (scoreCandidates.length === 0) continue;
    const score = scoreCandidates[scoreCandidates.length - 1];
    rows.push({ rank, nickname, scoreText: score.text, scoreValue: score.value });
  }
  return rows;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Lovely-Guild-Dashboard/1.15; +https://github.com/)"
    }
  });
  if (!response.ok) throw new Error(`MGF 조회 실패 ${response.status}`);
  return response.text();
}

function htmlToText(html) {
  return decodeHtmlEntities(String(html || ""))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

function normalizeKoreanPowerText(text) {
  const source = String(text || "").replace(/,/g, " ").replace(/\s+/g, " ").trim();
  const parts = [];
  for (const unit of ["경", "조", "억", "만"]) {
    const pattern = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unit}`, "g");
    const matches = [...source.matchAll(pattern)].map((item) => item[1]);
    if (matches.length) {
      const value = matches[matches.length - 1];
      if (Number(value) > 0) parts.push(`${value}${unit}`);
    }
  }
  return parts.join(" ");
}

function parseKoreanPowerValue(text) {
  const source = String(text || "").replace(/,/g, "").trim();
  if (/^\d+(\.\d+)?$/.test(source)) return Number(source);
  const gyeong = getLastUnitValue(source, "경");
  const jo = getLastUnitValue(source, "조");
  const eok = getLastUnitValue(source, "억");
  const man = getLastUnitValue(source, "만");
  return (gyeong * 10_000_000_000_000_000) +
    (jo * 1_000_000_000_000) +
    (eok * 100_000_000) +
    (man * 10_000);
}

function getLastUnitValue(source, unit) {
  const pattern = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unit}`, "g");
  const matches = [...String(source || "").matchAll(pattern)].map((item) => Number(item[1]));
  return matches.length ? matches[matches.length - 1] : 0;
}

function formatKoreanPower(value) {
  let n = Math.max(0, Math.floor(Number(value || 0)));
  const units = [
    ["경", 10_000_000_000_000_000],
    ["조", 1_000_000_000_000],
    ["억", 100_000_000],
    ["만", 10_000]
  ];
  const parts = [];
  for (const [label, size] of units) {
    const unitValue = Math.floor(n / size);
    n %= size;
    if (unitValue > 0) parts.push(`${unitValue}${label}`);
  }
  return parts.join(" ") || "0";
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function memberKey(guild, nickname) {
  return `${String(guild || "").trim()}::${String(nickname || "").trim()}`;
}

function guildInfoUrl(guildName) {
  return `${SOURCE_BASE}/contents/guild_info.php?g_name=${encodeURIComponent(guildName)}`;
}

function kstDateTimeString() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
