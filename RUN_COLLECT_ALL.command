#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
echo "Lovely 대시보드 전체 수집을 시작합니다."
echo "- MGF 길드 상세 기준: https://mgf.gg/contents/guild_info.php?g_name=LOVELY"
echo "- 핫딜: 기프트카드 최신 5개"
npm run collect:all-data
echo "완료: data/latest.json, data/guild-contents.json, data/hotdeals.json 갱신됨"
