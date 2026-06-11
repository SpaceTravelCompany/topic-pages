---
title: 시작하기
slug: getting-started
---

## 소개

이 문서는 `topic-pages` 빌더가 정상 동작하는지 확인하기 위한 **자체 검증(self-test)** 예시다.

## 빌드 명령

```bash
node scripts/build.mjs \
  --site templates/example-vulkan-ref/site.json \
  --content templates/example-vulkan-ref/content \
  --assets templates/example-vulkan-ref/assets \
  --out templates/example-vulkan-ref/dist
```

또는 패키지 root에서:

```bash
npm run self-test
```

## 확인 항목

- [ ] `templates/example-vulkan-ref/dist/index.html` 생성
- [ ] nav에 "topic-pages 예시" 타이틀 노출
- [ ] "topic-pages GitHub" 외부 링크 노출
- [ ] "시작하기" 토픽 클릭 시 본문 표시

## 코드 블록

```c
// 코드 하이라이트 확인
VkBufferCreateInfo info{};
info.size  = 1024;
info.usage = VK_BUFFER_USAGE_VERTEX_BUFFER_BIT;
```

## 표

| 컬럼1 | 컬럼2 |
|------|------|
| 값1 | 값2 |
| 값3 | 값4 |
