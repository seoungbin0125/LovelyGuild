#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
echo "버전: $(node -e "console.log(require('./package.json').version)")"
node - <<'NODE'
const data = require('./data/latest.json');
const members = data.members.filter((member) => member.guild === 'LOVELY');
console.log(`LOVELY 길드원: ${members.length}명`);
console.log(`수집 기준: ${data.dataSource || '-'}`);
console.log(`LOVELY URL: ${(data.sourceUrls || {})['LOVELY'] || '-'}`);
console.log('TOP 5:');
for (const m of members.slice(0, 5)) console.log(`${m.rank}. ${m.nickname} ${m.job} Lv.${m.level} ${m.powerText}`);
NODE
