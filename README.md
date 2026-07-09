# topic-pages

`site.json` + `content/*.md` → **단일 HTML SPA**로 빌드하는 정적 문서 사이트 빌더.

`vulkan-ref`를 일반화하면서 분리한 범용 엔진. Vulkan, WebGPU, OpenGL, DirectX 등 어떤 "주제별 참조" 사이트든 같은 형식으로 만들 수 있다.

## 특징

- **단일 페이지 앱**: 빌드 결과가 `dist/index.html` + `dist/assets/` 하나.
- **마크다운 + 커스텀 코드 블록**: 일반 마크다운, `cmdstack` 다이어그램, `relflow` 흐름도 지원.
- **외부 의존성 1개**: [`marked`](https://github.com/markedjs/marked) 외 없음.
- **로컬 서버 0개**: 더블클릭으로 `index.html` 열어도 동작.
- **도메인 무관**: `site.json`의 `title`, `subtitle`, `references`, `storagePrefix`로 모든 브랜딩 처리.

## 사용법

### 1. 신규 사이트 만들기

```bash
mkdir my-ref-site && cd my-ref-site
npm init -y
npm install github:SpaceTravelCompany/topic-pages#v1.0.0
```

`site.json` 작성:

```json
{
  "title": "My Reference",
  "subtitle": "주제별 정리",
  "storagePrefix": "my-ref",
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

`./dist/index.html`이 생성된다.

### 2. CLI 옵션

```bash
node scripts/build.mjs [옵션]

옵션:
  --site    <path>   site.json 경로 (기본: ./site.json)
  --content <path>   콘텐츠 디렉토리 (기본: ./content)
  --out     <path>   출력 디렉토리 (기본: ./dist)
  --assets  <path>   빌드에 포함할 에셋 디렉토리 (기본: ./assets)
```

에셋 디렉토리에는 `main.css`, `prism.css`, `prism.js`, `app.js`, `favicon.svg`, `cc-by-nc-sa.svg` 6개 파일이 필요하다. 빌더가 `./assets`에서 복사한다.

## site.json 스키마

```jsonc
{
  "title": "사이트 이름",                  // <title>, nav 브랜드에 사용
  "subtitle": "부제목",                    // nav 브랜드 부제목
  "brandMark": "Tp",                       // nav 좌측 2글자 마크 (선택, 기본: title 앞 2글자)
  "storagePrefix": "my-ref",               // localStorage 네임스페이스 (선택, 기본: "topic-pages")
  "references": [                          // nav 하단 외부 링크 (선택)
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
          "summary": "토픽 부제목 (nav 툴팁)",
          "icon": "▶"
        }
      ]
    }
  ]
}
```

## content/<slug>.md 형식

```markdown
---
title: 주제 이름
slug: 동일 slug
---

## 섹션 1

본문 마크다운. `##` 단위로 본문이 나뉘어 탭/스크롤 섹션이 된다.

## 섹션 2

`###` 이하 헤딩은 같은 섹션 안의 소제목으로 렌더링된다.
```

특수 코드 블록:

- ` ```cmdstack ` — 다이어그램 (vkCmd* 호출 흐름도 등)
- ` ```relflow ` — 좌우 두 박스 + 화살표 + 푸트 흐름도

## 디렉토리 구조

```
my-ref-site/
├── site.json
├── content/
│   ├── getting-started.md
│   ├── advanced.md
│   └── ...
├── assets/                  # 빌더가 dist로 복사
│   ├── main.css
│   ├── app.js
│   ├── prism.css
│   ├── prism.js
│   ├── favicon.svg
│   └── cc-by-nc-sa.svg
├── dist/                    # 빌드 결과
│   ├── index.html
│   └── assets/
└── package.json
```

## 사용 예

| 사이트 | 저장소 | 설명 |
|--------|--------|------|
| vulkan-ref | https://github.com/SpaceTravelCompany/vulkan-ref | Vulkan API 참조 |

## 라이선스

- 빌더 코드 (이 저장소): [MIT](LICENSE)
- 빌더가 생성한 문서 콘텐츠: 각 사이트가 지정한 콘텐츠 라이선스 따름
