# Lovely 길드 포털

현재 버전: **v1.29.0**

Lovely 길드용 대시보드입니다. 전투력/토벌전 현황, 캐릭터 모아보기, 길드 컨텐츠, 핫딜, 그리고 **실시간 토벌전 참여 확인** 기능이 포함되어 있습니다. v1.29.0부터 Lovely 전용 다크 네온 디자인을 적용했고, 광장/쉬어가기 탭은 숨겼습니다.

## 로컬 새 프로젝트 폴더

권장 위치:

```bash
/Users/bin/Desktop/work/lovely-guild-dashboard
```

적용:

```bash
cd ~/Downloads
unzip lovely-guild-dashboard-v1.29.0.zip
rsync -av --delete --exclude .git lovely-guild-dashboard/ /Users/bin/Desktop/work/lovely-guild-dashboard/
```

실행:

```bash
cd /Users/bin/Desktop/work/lovely-guild-dashboard
npm run serve
```


## Cloudflare Pages 바로 배포

실시간 토벌전 탭은 `/api/tobeol` Pages Function을 사용하므로, 실제 운영은 Cloudflare Pages 주소에서 하는 것을 권장합니다.

처음 한 번 전체 설정 + 배포:

```bash
cd /Users/bin/Desktop/work/lovely-guild-dashboard
npm install
npm run cf:setup
```

명령이 하는 일:

1. `wrangler login`으로 Cloudflare 계정 인증
2. `lovely-guild-dashboard` Pages 프로젝트 생성
3. `.cloudflare-pages-output` 폴더에 정적 파일 준비
4. `functions/api/tobeol.js`와 함께 Cloudflare Pages에 배포

이미 프로젝트가 만들어져 있으면 이후에는 배포만 하면 됩니다.

```bash
npm run cf:deploy
```

배포 후 접속 주소:

```text
https://lovely-guild-dashboard.pages.dev
```

실시간 토벌 API 확인 주소:

```text
https://lovely-guild-dashboard.pages.dev/api/tobeol?guild=lovely&server=4
```

프로젝트 이름을 바꾸고 싶으면 이렇게 실행하세요.

```bash
CF_PAGES_PROJECT=lovelyguild npm run cf:setup
```

맥에서는 `DEPLOY_TO_CLOUDFLARE.command`를 더블클릭해도 같은 작업을 실행합니다.

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

## v1.29.0 핫딜 수집 주의

아카라이브가 GitHub Actions 서버 요청을 403으로 차단할 수 있어, `collect:hotdeals`는 실패해도 전체 자동 수집이 깨지지 않도록 안전 처리합니다. 실패 시 `data/hotdeals.json`에 실패 사유를 기록하고 기존 목록 또는 빈 목록을 유지합니다.
