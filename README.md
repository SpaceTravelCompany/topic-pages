# topic-pages

`site.json` + `content/*.md` → **정적 멀티페이지 문서 사이트**로 빌드하는 빌더.

`vulkan-ref`를 일반화하면서 분리한 범용 엔진. Vulkan, WebGPU, OpenGL, DirectX 등 어떤 "주제별 참조" 사이트든 같은 형식으로 만들 수 있다.

## 특징

- **정적 MPA**: 랜딩 `dist/index.html` + 주제마다 `dist/topics/<slug>.html` + `dist/search-index.json` + `dist/assets/`.
- **라이트 전용 디자인**: 검정 헤더, 액센트 색 하나(`theme.accent`), 1px 검정 테두리와 오프셋 그림자. 다크 모드·테마 토글은 없다.
- **브라우저 확대 대응**: 글자 크기 버튼 대신 `Ctrl + 휠`(브라우저 확대)로 글자가 커지고 작아진다. 모든 크기와 브레이크포인트가 `rem`/`em`이라 50%~500% 확대에서도 가로 스크롤·겹침·잘림 없이 레이아웃이 따라온다.
- **문서 스크롤 레이아웃**: 사이드바(주제 필터 포함)와 오른쪽 목차는 sticky, 좁은 폭에서는 드로어로 바뀐다. 오른쪽 목차는 스크롤 위치를 따라 현재 항목을 표시한다.
- **마크다운 + 커스텀 코드 블록**: 일반 마크다운, KaTeX 수식, 콜아웃, `cmdstack` · `relflow` · `flowchart` 다이어그램.
- **전문 검색**: 빌드 때 만든 `search-index.json`을 `Ctrl + K`로 검색.
- **외부 의존성 2개**: [`marked`](https://github.com/markedjs/marked)와 그래프 배치용 [`@dagrejs/dagre`](https://github.com/dagrejs/dagre). 다이어그램 엔진은 빌드 결과에 포함한다. (웹폰트·KaTeX는 CDN에서 불러온다.)
- **도메인 무관**: `site.json`의 `title`, `subtitle`, `references`, `theme`, `storagePrefix`로 브랜딩을 모두 처리.

## 사용법

### 1. 신규 사이트 만들기

```bash
mkdir my-ref-site && cd my-ref-site
npm init -y
npm install github:SpaceTravelCompany/topic-pages#main
```

`site.json` 작성:

```json
{
  "title": "My Reference",
  "subtitle": "주제별 정리",
  "storagePrefix": "my-ref",
  "theme": { "accent": "#63C8C1" },
  "references": [
    { "label": "공식 문서", "href": "https://example.com/docs" }
  ],
  "sections": [
    {
      "id": "intro",
      "title": "소개",
      "topics": [
        { "slug": "getting-started", "title": "시작하기", "summary": "...", "icon": "▶" }
      ]
    }
  ]
}
```

`content/getting-started.md` 작성:

```markdown
---
title: 시작하기
slug: getting-started
---

## 첫 섹션

본문...
```

빌드:

```bash
npx topic-pages build
# 또는
node node_modules/topic-pages/scripts/build.mjs
```

`./dist/`가 생성된다. `search-index.json`을 `fetch`로 읽으므로 `file://`이 아니라 정적 서버(또는 GitHub Pages)로 열어야 검색이 동작한다.

### 2. CLI 옵션

```bash
node scripts/build.mjs [옵션]

옵션:
  --site     <path>  site.json 경로 (기본: ./site.json)
  --content  <path>  콘텐츠 디렉토리 (기본: ./content)
  --out      <path>  출력 디렉토리 (기본: ./dist)
  --assets   <path>  빌드에 포함할 에셋 디렉토리 (기본: ./assets)
  --base-url <url>   절대 URL 기준 (site.json 의 baseUrl 보다 우선)
```

`main.css`, `prism.css`, `prism.js`, `app.js`, `favicon.svg`는 사용자 `assets/`에 없으면 빌더 기본본을 쓴다. 보통은 `favicon.svg`만 사이트별로 두면 된다. `assets/custom.css`, `assets/custom.js`가 있으면 자동으로 로드된다. 그 밖의 파일(이미지 등)은 `dist/assets/`로 그대로 복사된다.

## site.json 스키마

```jsonc
{
  "title": "사이트 이름",                  // <title>, 헤더 브랜드에 사용
  "subtitle": "부제목",                    // (선택) 랜딩 제목 아래·meta description 에 사용
  "brandMark": "Tp",                       // 헤더 좌측 마크 (선택, 기본: title 앞 2글자)
  "brandMarkSvg": "<svg ...>...</svg>",    // (선택) 인라인 SVG 마크. brandMark 보다 우선, 안전 검사 통과 시만 적용
  "storagePrefix": "my-ref",               // localStorage 네임스페이스 (선택, 기본: "topic-pages")
  "baseUrl": "https://user.github.io/repo",// (선택) 서브경로 배포용 절대 URL
  "bodyFont": "mono",                      // (선택) 본문 폰트: "mono"(기본) | "sans"
  "theme": {                               // (선택) 라이트 전용
    "accent": "#63C8C1",                   // 액센트 색 (기본 #63C8C1)
    "link": "#005CC5"                      // 본문 링크색 (기본 #005CC5)
  },
  "references": [                          // 푸터의 "참고 자료" 링크 (선택)
    { "label": "공식 문서", "href": "https://..." }
  ],
  "sections": [
    {
      "id": "그룹 id",
      "title": "그룹 이름",
      "topics": [
        {
          "slug": "content/<slug>.md 와 매칭되는 식별자",
          "title": "토픽 이름",
          "summary": "토픽 한 줄 요약 (카드·사이드바 필터·문서 머리에 사용)",
          "icon": "▶"
        }
      ]
    }
  ]
}
```

### 액센트 색 (`theme.accent`)

사이트마다 하나만 정하면 나머지는 자동으로 파생된다.

- `--accent`: 입력한 색. 브랜드 마크, 활성 사이드바 항목, 콜아웃 칩, 목차 활성 마커 등.
- `--accent-dark`: `--accent`를 검정과 45% 섞은 색 (테두리, 오프셋 그림자).
- `--accent-soft`: `--accent`를 흰색과 80% 섞은 색 (아이콘 박스, 콜아웃 배경).
- `--accent-fg`: 액센트 위에 올리는 글자색. 값이 hex(`#rgb` / `#rrggbb`)면 명암 대비로 검정/흰색을 자동 선택한다.

값은 CSS 색 문자열만 허용한다(`#hex`, `rgb()`, `oklch()`, `hsl()`, `var(--x)`, 색 이름). 그 밖의 값은 경고 후 무시된다.

레거시 `theme.light.accent` / `theme.light.brand` / `theme.light.link`도 그대로 읽는다. `theme.dark`는 무시한다(경고 출력).

### 본문 폰트 (`bodyFont`)

- `"mono"` (기본): DM Mono + Nanum Gothic Coding
- `"sans"`: IBM Plex Sans KR

제목과 UI는 항상 Bebas Neue / Do Hyeon, 코드는 DM Mono 계열이다. 폰트는 Google Fonts CDN에서 불러온다.

## content/<slug>.md 형식

```markdown
---
title: 주제 이름
slug: 동일 slug
---

## 섹션 1

본문 마크다운. `##` 단위로 본문이 섹션으로 나뉘어 한 페이지에 이어진다.

## 섹션 2

`###` 이하 헤딩은 같은 섹션 안의 소제목으로 렌더링되고 오른쪽 목차에도 나타난다.
```

주제 제목이 `동기화 (Synchronization)`처럼 끝이 괄호로 닫히면 문서 머리 제목이 `동기화` / `Synchronization` 두 줄로 나뉜다.

특수 블록:

- ` ```cmdstack ` — 명령 호출 흐름 다이어그램 (vkCmd* 등)
- ` ```relflow ` — 좌우 두 박스 + 화살표 + 푸트 흐름도
- ` ```flowchart ` — Mermaid 부분집합 흐름도
- `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`, `> [!DANGER]`, `> [!INFO]`, `> [!SUCCESS]` — 콜아웃
- `$...$`, `$$...$$` — KaTeX 수식

### Flowchart

노드·라벨의 실제 크기를 브라우저에서 측정해 Dagre로 노드와 연결선을 함께 배치한다. 폰트 로딩·화면 크기·글자 크기가 바뀌면 다시 계산한다. 넓은 그래프는 다이어그램 안에서 가로로 스크롤하며, 인쇄할 때는 노드와 선을 함께 축소한다.

지원 문법은 `flowchart TD|TB|BT|LR|RL`, 사각형 `A["text"]`, 둥근 노드 `A(["text"])` / `A(text)`, `-->` 연결·연쇄, `-->|"label"|` 라벨, `A & B --> C & D` 분기·합류, `subgraph ID["title"]` … `end` 묶음이다. `;`로 문장을 나누고 `%%`로 주석을 쓸 수 있다. 라벨 안의 `\n`은 줄바꿈으로 표시한다. 레벨을 건너뛰는 연결, 순환 연결, 자기 자신으로 돌아가는 연결도 보존한다. Mermaid 전체 문법을 지원하지는 않으며, 묶음 자체를 연결하는 화살표 등 지원하지 않는 문법은 원문 코드로 표시한다.

JavaScript가 꺼져 있으면 노드와 전체 연결 목록을 표시한다. 다이어그램 엔진과 라이선스는 `dist/assets/dagre.min.js`와 `dist/assets/dagre.min.js.LEGAL.txt`에 포함되어 CDN 연결 없이 동작한다.

화면 회귀 테스트:

```bash
npm ci
npx playwright install chromium
npm test
```

## 디렉토리 구조

```
my-ref-site/
├── site.json
├── content/
│   ├── getting-started.md
│   └── ...
├── assets/                  # (선택) favicon.svg, custom.css/js, 콘텐츠용 이미지 등
│   └── favicon.svg
├── dist/                    # 빌드 결과
│   ├── index.html
│   ├── topics/<slug>.html
│   ├── search-index.json
│   └── assets/
└── package.json
```

## 사용 예

| 사이트 | 저장소 | 설명 |
|--------|--------|------|
| vulkan-ref | https://github.com/SpaceTravelCompany/vulkan-ref | Vulkan API 참조 |

## 라이선스

[MIT](LICENSE)
