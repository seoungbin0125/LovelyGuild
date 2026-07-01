# Lovely 길드 포털

현재 버전: **v1.17.0**

Lovely 길드용 대시보드입니다. 전투력/토벌전 현황, 캐릭터 모아보기, 길드 컨텐츠, 핫딜, 그리고 **실시간 토벌전 참여 확인** 기능이 포함되어 있습니다. v1.17.0부터 Lovely 전용 다크 네온 디자인을 적용했고, 광장/쉬어가기 탭은 숨겼습니다.

## 로컬 새 프로젝트 폴더

권장 위치:

```bash
/Users/bin/Desktop/work/lovely-guild-dashboard
```

적용:

```bash
cd ~/Downloads
unzip lovely-guild-dashboard-v1.17.0.zip
rsync -av --delete lovely-guild-dashboard/ /Users/bin/Desktop/work/lovely-guild-dashboard/
```

실행:

```bash
cd /Users/bin/Desktop/work/lovely-guild-dashboard
npm run serve
```

## 데이터 수집

Lovely 길드원은 아래 MGF 길드 상세 페이지 기준으로 수집합니다.

```text
https://mgf.gg/contents/guild_info.php?g_name=LOVELY
```

전체 수집:

```bash
npm run collect:all-data
```

Lovely 길드원만 수집:

```bash
npm run collect:lovely
```

## 실시간 토벌전 참여 확인

상단 메뉴의 **실시간 토벌** 탭에서 길드명을 입력하고 조회하면 됩니다.

- 기본 길드명: `lovely`
- 기본 서버 번호: `4`
- 조회할 때마다 MGF에서 길드원 목록과 토벌전 랭킹을 새로 가져옵니다.
- 점수가 있으면 `친 사람`, 점수가 없거나 랭킹에서 매칭되지 않으면 `아직 안 친 사람`으로 표시합니다.

로컬에서는 `npm run serve`로 실행해야 `/api/tobeol`이 동작합니다.
Cloudflare Pages에 올리면 `functions/api/tobeol.js`가 같은 역할을 합니다.

## GitHub Actions

`.github/workflows/collect.yml`은 매일 KST 00:10에 실행됩니다.

수집 내용:

- Lovely 길드원 데이터
- 길드 컨텐츠
- 기프트카드 핫딜

핫딜만 별도로 매시간 갱신하는 `.github/workflows/collect-hotdeals.yml`도 포함되어 있습니다.

## v1.17.0 핫딜 수집 주의

아카라이브가 GitHub Actions 서버 요청을 403으로 차단할 수 있어, `collect:hotdeals`는 실패해도 전체 자동 수집이 깨지지 않도록 안전 처리합니다. 실패 시 `data/hotdeals.json`에 실패 사유를 기록하고 기존 목록 또는 빈 목록을 유지합니다.
