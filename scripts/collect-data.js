import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const SOURCE_BASE = process.env.SOURCE_BASE || `https://${["m", "g", "f"].join("")}.gg`;
const DEFAULT_GUILD_NAMES = parseGuildNames(
  process.env.GUILD_NAMES || process.env.GUILD_NAME || "LOVELY"
);
const DEFAULT_SERVER_ID = process.env.SERVER_ID || "4";
const DEFAULT_TOBEOL_MAX_PAGE = Number(process.env.TOBEOL_MAX_PAGE || 10);
const DEFAULT_MEMBER_LIMIT = Number(process.env.MEMBER_LIMIT || 100);
const DEFAULT_COMPARE_OFFSET_DAYS = Number(process.env.COMPARE_OFFSET_DAYS || -7);

const DATA_DIR = path.join(ROOT_DIR, "data");
const LATEST_PATH = path.join(DATA_DIR, "latest.json");
const HISTORY_PATH = path.join(DATA_DIR, "history.json");
const MANUAL_PATH = path.join(DATA_DIR, "manual.json");

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const guildNames = parseGuildNames(args.guilds || args.guild || DEFAULT_GUILD_NAMES);
  const serverId = args.server || DEFAULT_SERVER_ID;
  const maxPage = Number(args.maxPage || DEFAULT_TOBEOL_MAX_PAGE);
  const memberLimit = Number(args.memberLimit || DEFAULT_MEMBER_LIMIT);
  const today = kstDateString();
  const compareOffsetDays = Number(args.compareOffsetDays || DEFAULT_COMPARE_OFFSET_DAYS);
  const comparisonTargetDate = args.compareDate || kstDateString(compareOffsetDays);

  if (guildNames.length === 0) {
    throw new Error("수집할 길드명이 없습니다. GUILD_NAMES 또는 --guilds 값을 확인해주세요.");
  }

  console.log(`🚀 길드 데이터 수집 시작: guilds=${guildNames.join(", ")}, server=${serverId}, date=${today}, compare=${comparisonTargetDate}`);

  await fs.mkdir(DATA_DIR, { recursive: true });

  const guildResults = [];

  for (const guildName of guildNames) {
    console.log(`\n[길드 수집] ${guildName}`);

    const sourceUrl = guildInfoUrl(guildName);
    console.log(`↳ 기준 URL: ${sourceUrl}`);

    const guildHtml = await fetchHtml(sourceUrl);
    const members = parseGuildMembersFromText(htmlToText(guildHtml))
      .slice(0, memberLimit)
      .map((member) => ({
        ...member,
        guild: guildName,
        memberKey: memberKey(guildName, member.nickname)
      }));

    if (members.length === 0) {
      console.warn(`⚠️ 길드원 목록을 찾지 못했습니다: ${guildName}`);
    } else {
      console.log(`✅ ${guildName} 길드원 ${members.length}명 수집 완료`);
    }

    guildResults.push({ guild: guildName, members, sourceUrl });
    await sleep(350);
  }

  const allMembers = guildResults.flatMap((item) => item.members);

  if (allMembers.length === 0) {
    throw new Error("모든 길드에서 길드원 목록을 찾지 못했습니다. 수집 대상 페이지 구조가 변경되었을 수 있습니다.");
  }

  const tobeolMap = await fetchTobeolScoresByFetch({
    members: allMembers,
    serverId,
    maxPage
  });

  console.log("✅ 토벌전 점수 매칭 완료");

  const history = await readJsonFile(HISTORY_PATH, []);
  const manual = await readJsonFile(MANUAL_PATH, null);
  const previousSnapshotsByGuild = new Map(
    guildNames.map((guild) => [guild, findWeeklySnapshot(history, comparisonTargetDate, guild)])
  );

  const departedMembersByGuild = {};

  const mergedMembers = guildResults.flatMap(({ guild, members, sourceUrl }) => {
    const previousSnapshot = previousSnapshotsByGuild.get(guild);
    const previousMembers = previousSnapshot?.members || [];
    const previousMemberMap = new Map(
      previousMembers.map((member) => [member.nickname, member])
    );
    const currentNicknameSet = new Set(members.map((member) => member.nickname));

    departedMembersByGuild[guild] = previousMembers
      .filter((member) => member?.nickname && !currentNicknameSet.has(member.nickname))
      .map((member) => ({
        guild,
        nickname: member.nickname,
        rank: member.rank ?? null,
        job: member.job || "",
        level: member.level ?? null,
        powerValue: member.powerValue ?? null,
        powerText: member.powerValue == null ? null : formatKoreanPower(member.powerValue),
        tobeolValue: member.tobeolValue ?? null,
        tobeolText: member.tobeolValue == null ? null : formatKoreanPower(member.tobeolValue)
      }));

    return members.map((member) => {
      const nickname = member.nickname;
      const currentTobeolValue = tobeolMap.get(member.memberKey) || 0;
      const previous = previousMemberMap.get(nickname) || null;
      const powerGrowthValue = previous ? member.powerValue - Number(previous.powerValue || 0) : null;
      const tobeolGrowthValue = previous ? currentTobeolValue - Number(previous.tobeolValue || 0) : null;
      const memberStatus = previous ? "existing" : "new";

      return {
        guild,
        sourceUrl,
        memberStatus,
        rank: member.rank,
        nickname,
        job: member.job,
        level: member.level,
        powerValue: member.powerValue,
        powerText: member.powerText || formatKoreanPower(member.powerValue),
        previousPowerValue: previous?.powerValue ?? null,
        previousPowerText: previous ? formatKoreanPower(previous.powerValue) : null,
        powerGrowthValue,
        powerGrowthText: powerGrowthValue == null ? null : formatSignedKoreanPower(powerGrowthValue),
        powerGrowthRate: calcGrowthRate(member.powerValue, previous?.powerValue),
        tobeolValue: currentTobeolValue,
        tobeolText: formatKoreanPower(currentTobeolValue),
        previousTobeolValue: previous?.tobeolValue ?? null,
        previousTobeolText: previous ? formatKoreanPower(previous.tobeolValue) : null,
        tobeolGrowthValue,
        tobeolGrowthText: tobeolGrowthValue == null ? null : formatSignedKoreanPower(tobeolGrowthValue),
        tobeolGrowthRate: calcGrowthRate(currentTobeolValue, previous?.tobeolValue)
      };
    });
  });

  const manualAppliedCount = applyManualOverridesToMembers(mergedMembers, manual, today);

  const latest = {
    ok: true,
    version: 5,
    appVersion: "v1.29.0",
    guilds: guildNames,
    guild: guildNames.join(" · "),
    capturedDate: today,
    comparisonMode: "weekly",
    comparisonOffsetDays: compareOffsetDays,
    comparisonTargetDate,
    comparisonDates: Object.fromEntries(
      guildNames.map((guild) => [guild, previousSnapshotsByGuild.get(guild)?.date || null])
    ),
    comparisonDateText: buildComparisonDateText(guildNames, previousSnapshotsByGuild, comparisonTargetDate),
    dataSource: "MGF guild_info",
    sourceUrls: Object.fromEntries(guildResults.map((item) => [item.guild, item.sourceUrl])),
    summary: buildSummary(mergedMembers),
    manualAppliedCount,
    memberChanges: buildMemberChanges(guildNames, mergedMembers, departedMembersByGuild),
    departedMembers: Object.values(departedMembersByGuild).flat(),
    guildSummaries: Object.fromEntries(
      guildNames.map((guild) => [
        guild,
        buildSummary(mergedMembers.filter((member) => member.guild === guild))
      ])
    ),
    members: mergedMembers
  };

  const nextHistory = upsertHistoryList(history, guildNames.map((guild) => ({
    date: today,
    guild,
    sourceUrl: guildInfoUrl(guild),
    members: mergedMembers
      .filter((member) => member.guild === guild)
      .map((member) => ({
        nickname: member.nickname,
        rank: member.rank,
        job: member.job,
        level: member.level,
        powerValue: member.powerValue,
        tobeolValue: member.tobeolValue
      }))
  })));

  await writeJsonFile(LATEST_PATH, latest);
  await writeJsonFile(HISTORY_PATH, nextHistory);

  console.log(`🎉 완료: ${LATEST_PATH}`);
}

async function fetchTobeolScoresByFetch({ members, serverId, maxPage }) {
  const nicknameToKeys = new Map();

  for (const member of members) {
    const nickname = String(member.nickname || "").trim();
    if (!nickname) continue;

    if (!nicknameToKeys.has(nickname)) {
      nicknameToKeys.set(nickname, []);
    }
    nicknameToKeys.get(nickname).push(member.memberKey || memberKey(member.guild, nickname));
  }

  const map = new Map();

  for (let page = 1; page <= maxPage; page += 1) {
    const url = `${SOURCE_BASE}/ranking/guild_boss.php?server=${encodeURIComponent(serverId)}&job=&page=${page}`;
    console.log(`토벌전 페이지 수집: ${page}/${maxPage}`);

    try {
      const html = await fetchHtml(url);
      const rows = parseTobeolRowsFromText(htmlToText(html));

      for (const row of rows) {
        const keys = nicknameToKeys.get(row.nickname) || [];
        for (const key of keys) {
          if (row.scoreValue > 0) {
            map.set(key, row.scoreValue);
          }
        }
      }
    } catch (error) {
      console.warn(`⚠️ 토벌전 페이지 수집 실패: page=${page}, ${error.message}`);
    }

    await sleep(350);
  }

  for (const member of members) {
    const key = member.memberKey || memberKey(member.guild, member.nickname);
    if (!map.has(key)) {
      map.set(key, 0);
    }
  }

  return map;
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
      .map((value) => ({
        text: value,
        value: parseKoreanPowerValue(value)
      }))
      .filter((item) => item.value > 0);

    if (scoreCandidates.length === 0) continue;

    const score = scoreCandidates[scoreCandidates.length - 1];

    rows.push({
      rank,
      nickname,
      scoreText: score.text,
      scoreValue: score.value
    });
  }

  return rows;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Guild-Dashboard/2.0; +https://github.com/)"
    }
  });

  if (!response.ok) {
    throw new Error(`fetch 실패 ${response.status}: ${url}`);
  }

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

  if (/^\d+(\.\d+)?$/.test(source)) {
    return Number(source);
  }

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
    if (unitValue > 0) {
      parts.push(`${unitValue}${label}`);
    }
  }

  return parts.join(" ") || "0";
}

function formatSignedKoreanPower(value) {
  const n = Number(value || 0);
  if (n === 0) return "0";
  return `${n > 0 ? "+" : "-"}${formatKoreanPower(Math.abs(n))}`;
}

function calcGrowthRate(current, previous) {
  const c = Number(current || 0);
  const p = Number(previous || 0);
  if (!p) return null;
  return Number((((c - p) / p) * 100).toFixed(2));
}


function applyManualOverridesToMembers(members, manual, today) {
  if (!manual || !Array.isArray(manual.items) || manual.items.length === 0) {
    return 0;
  }

  if (manual.date && manual.date !== today) {
    console.log(`ℹ️ 수동 보정값 날짜가 오늘과 달라 적용하지 않습니다: manual=${manual.date}, today=${today}`);
    return 0;
  }

  const manualMap = new Map(
    manual.items
      .filter((item) => item && item.guild && item.nickname)
      .map((item) => [memberKey(item.guild, item.nickname), item])
  );

  let appliedCount = 0;

  for (const member of members) {
    const override = manualMap.get(memberKey(member.guild, member.nickname));
    if (!override) continue;

    let applied = false;
    const hasPower = hasManualValue(override, "power");
    const hasPreviousPower = hasManualValue(override, "previousPower");
    const hasTobeol = hasManualValue(override, "tobeol");
    const hasPreviousTobeol = hasManualValue(override, "previousTobeol");

    if (hasPower) {
      member.powerValue = manualValue(override, "power", member.powerValue);
      member.powerText = member.powerValue == null ? null : formatKoreanPower(member.powerValue);
      applied = true;
    }

    if (hasPreviousPower) {
      member.previousPowerValue = manualValue(override, "previousPower", member.previousPowerValue);
      member.previousPowerText = member.previousPowerValue == null ? null : formatKoreanPower(member.previousPowerValue);
      applied = true;
    }

    if (hasPower || hasPreviousPower) {
      member.powerGrowthValue = member.previousPowerValue == null ? null : Number(member.powerValue || 0) - Number(member.previousPowerValue || 0);
      member.powerGrowthText = member.powerGrowthValue == null ? null : formatSignedKoreanPower(member.powerGrowthValue);
      member.powerGrowthRate = calcGrowthRate(member.powerValue, member.previousPowerValue);
    }

    if (hasTobeol) {
      member.tobeolValue = manualValue(override, "tobeol", member.tobeolValue);
      member.tobeolText = member.tobeolValue == null ? null : formatKoreanPower(member.tobeolValue);
      applied = true;
    }

    if (hasPreviousTobeol) {
      member.previousTobeolValue = manualValue(override, "previousTobeol", member.previousTobeolValue);
      member.previousTobeolText = member.previousTobeolValue == null ? null : formatKoreanPower(member.previousTobeolValue);
      applied = true;
    }

    if (hasTobeol || hasPreviousTobeol) {
      member.tobeolGrowthValue = member.previousTobeolValue == null ? null : Number(member.tobeolValue || 0) - Number(member.previousTobeolValue || 0);
      member.tobeolGrowthText = member.tobeolGrowthValue == null ? null : formatSignedKoreanPower(member.tobeolGrowthValue);
      member.tobeolGrowthRate = calcGrowthRate(member.tobeolValue, member.previousTobeolValue);
    }

    if (applied || override.memo) {
      member.isManual = true;
      member.manualMemo = override.memo || "";
      appliedCount += 1;
    }
  }

  if (appliedCount > 0) {
    console.log(`✅ 수동 보정값 ${appliedCount}건 적용`);
  }

  return appliedCount;
}

function hasManualValue(item, prefix) {
  return item?.[`${prefix}Value`] !== undefined || item?.[`${prefix}Text`] !== undefined;
}


function manualValue(item, prefix, fallback) {
  const valueKey = `${prefix}Value`;
  const textKey = `${prefix}Text`;

  if (item[valueKey] !== undefined && item[valueKey] !== "") {
    return item[valueKey] == null ? null : Number(item[valueKey] || 0);
  }

  if (item[textKey] !== undefined) {
    const text = String(item[textKey] || "").trim();
    return text ? parseKoreanPowerValue(text) : null;
  }

  return fallback == null ? null : Number(fallback || 0);
}


function buildMemberChanges(guildNames, members, departedMembersByGuild) {
  const result = {};
  for (const guild of guildNames) {
    const guildMembers = members.filter((member) => member.guild === guild);
    const newMembers = guildMembers
      .filter((member) => member.memberStatus === "new")
      .map((member) => ({
        guild,
        nickname: member.nickname,
        rank: member.rank ?? null,
        job: member.job || "",
        level: member.level ?? null,
        powerValue: member.powerValue ?? null,
        powerText: member.powerText || null,
        tobeolValue: member.tobeolValue ?? null,
        tobeolText: member.tobeolText || null
      }));

    result[guild] = {
      newCount: newMembers.length,
      departedCount: (departedMembersByGuild[guild] || []).length,
      newMembers,
      departedMembers: departedMembersByGuild[guild] || []
    };
  }
  return result;
}

function buildComparisonDateText(guildNames, previousSnapshotsByGuild, comparisonTargetDate) {
  const entries = guildNames.map((guild) => {
    const date = previousSnapshotsByGuild.get(guild)?.date || null;
    return date ? `${guild}: ${date}` : `${guild}: ${comparisonTargetDate} 데이터 없음`;
  });

  return entries.join(" · ");
}

function buildSummary(members) {
  return {
    guildCount: new Set(members.map((member) => member.guild).filter(Boolean)).size,
    memberCount: members.length,
    totalPowerValue: members.reduce((sum, member) => sum + Number(member.powerValue || 0), 0),
    totalTobeolValue: members.reduce((sum, member) => sum + Number(member.tobeolValue || 0), 0)
  };
}

function findWeeklySnapshot(history, comparisonTargetDate, guildName) {
  return [...(Array.isArray(history) ? history : [])]
    .find((snapshot) => snapshot && snapshot.guild === guildName && snapshot.date === comparisonTargetDate) || null;
}

function upsertHistoryList(history, todaySnapshots) {
  const list = Array.isArray(history) ? history : [];
  const snapshotKeys = new Set(todaySnapshots.map((item) => `${item.date}::${item.guild}`));
  const filtered = list.filter((item) => !snapshotKeys.has(`${item.date}::${item.guild}`));
  const next = [...filtered, ...todaySnapshots]
    .sort((a, b) => `${a.date}::${a.guild}`.localeCompare(`${b.date}::${b.guild}`));

  return next.slice(-120);
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function guildInfoUrl(guildName) {
  return `${SOURCE_BASE}/contents/guild_info.php?g_name=${encodeURIComponent(guildName)}`;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function memberKey(guild, nickname) {
  return `${String(guild || "").trim()}::${String(nickname || "").trim()}`;
}

function parseGuildNames(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => parseGuildNames(item));
  }

  return String(value || "")
    .split(/[,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function kstDateString(offsetDays = 0) {
  const now = new Date();
  return new Date(
    now.getTime() + 9 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000
  ).toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(args) {
  return Object.fromEntries(
    args
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...rest] = arg.slice(2).split("=");
        return [toCamelCase(key), rest.join("=")];
      })
  );
}

function toCamelCase(value) {
  return String(value || "").replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

run().catch((error) => {
  console.error("치명적 오류 발생:", error);
  process.exit(1);
});
