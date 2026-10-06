---
title: Flowcharts
slug: diagrams
---

## Workgroups

```flowchart
  A(["Dispatch (groupCount = 4,1,1)"])
  B["Workgroup (0,0,0) — 256 threads"]
  C["LocalInvocation 0 — GlobalID = (0,0,0)"]
  D["LocalInvocation 1 — GlobalID = (1,0,0)"]
  E["..."]
  F["LocalInvocation 255"]
  G["Workgroup (1,0,0) — 256 threads"]
  H["Workgroup (2,0,0) — 256 threads"]
  I["Workgroup (3,0,0) — 256 threads"]
  J["총 4 × 256 = 1024 invocations"]
  A --> B
  B --> C
  B --> D
  B --> E
  B --> F
  A --> G
  A --> H
  A --> I
  B & G & H & I --> J
```

## Pipelines

```flowchart
flowchart TD
  A["전통적 파이프라인"]
  A1["Vertex Buffer → Vertex Input/IA → Vertex Shader"]
  A2["→ Tessellation/Geometry → Rasterizer → Fragment Shader"]
  A --> A1 --> A2
  B["메시 셰이더 파이프라인"]
  B1["Scene/Meshlet Buffer → Task Shader (선택: 컬링/LOD)"]
  B2["→ Mesh Shader (정점·프리미티브 생성)"]
  B3["→ Rasterizer → Fragment Shader"]
  B --> B1 --> B2 --> B3
```

## Skip levels and cycles

```flowchart
flowchart TD
  A["Start"] --> B["Middle"] --> C["End"]
  A -->|"Skip this level"| C
  C -->|"Retry"| A
  B -->|"Repeat"| B
```

## Left to right

```flowchart
flowchart LR
  A["Input"] --> B["Branch 1"] & C["Branch 2"] --> D(["Join"])
```

## Right to left

```flowchart
flowchart RL
  A["Input"] --> B["Output"]
```

## Labels and statement separators

```flowchart
flowchart BT
  %% Operators inside labels are text.
  A["<img src=x onerror=alert(1)> & --> ;"] -->|"A & B; -->"| B["Line one\nLine two"]; B --> C["Done"]
```

## Subgraphs

```flowchart
flowchart TD
  subgraph Traditional["기존 렌더 패스 방식"]
    A["Render pass"] --> B["Draw"]
  end
  subgraph Dynamic["Dynamic Rendering 방식"]
    C["Pipeline"] --> D["Draw"] --> E["Barrier"]
  end
```

## Unequal node heights in neighboring branches

```flowchart
flowchart TD
  A["VkDescriptorSetLayout — 리소스 바인딩 규격 정의"]
  B["binding 0: uniform buffer (vertex)"]
  C["binding 1: combined image sampler (fragment)"]
  D["VkPipelineLayout — 파이프라인에 바인딩할 레이아웃 집합"]
  E["set 0: 위의 DescriptorSetLayout"]
  F["set 1: 머티리얼 전용 DescriptorSetLayout"]
  G["push constant range"]
  H["VkPipeline — 파이프라인 생성 시 파이프라인 레이아웃 등록"]
  I["VkDescriptorPool — 디스크립터 메모리 풀"]
  J["VkDescriptorSet — 실제 GPU 리소스를 가리키는 세트"]
  K["binding 0: 특정 VkBuffer + offset"]
  L["binding 1: 특정 VkImageView + VkSampler"]
  M(["vkCmdBindDescriptorSets() — 드로우 호출 전 바인딩"])
  A --> B
  A --> C
  A --> D
  D --> E
  D --> F
  D --> G
  D --> H
  H --> I
  I --> J
  J --> K
  J --> L
  J --> M
```
