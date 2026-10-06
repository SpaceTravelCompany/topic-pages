(function () {
  "use strict";

  // 브라우저 자동 스크롤 복원 비활성화 — 토픽별 스크롤을 직접 복원.
  // 최상단에서 가능한 한 빨리 설정해야 브라우저가 개입하기 전에 적용됨.
  if (window.history && "scrollRestoration" in window.history) {
    window.history.scrollRestoration = "manual";
  }

  if (typeof Prism !== "undefined" && Prism.plugins && Prism.plugins.toolbar && Prism.hooks.all.complete) {
    Prism.hooks.all.complete = Prism.hooks.all.complete.filter(function (fn) {
      return fn !== Prism.plugins.toolbar.hook;
    });
  }

  var pageType = document.body.dataset.pageType || "landing";
  var topicSlug = document.body.dataset.topicSlug || "";
  var STORAGE_PREFIX = document.body.dataset.storagePrefix || "topic-pages";
  var searchIndexUrl = document.body.dataset.searchIndexUrl || "search-index.json";

  var viewportEl = document.getElementById("content-viewport");
  var navPanel = document.querySelector(".nav-panel");
  var navToggle = document.getElementById("nav-toggle");
  var navClose = document.getElementById("nav-close");
  var navBackdrop = document.getElementById("nav-backdrop");
  var tocToggleBtn = document.getElementById("floating-toc-btn") || document.getElementById("toc-toggle");
  var tocPanel = document.getElementById("toc-panel");
  var tocBackdrop = document.getElementById("toc-backdrop");

  /* ── 반응형 상태 ──
     CSS 와 같은 em 기반 쿼리를 쓴다 — px 기준으로 판단하면 브라우저 확대(Ctrl+휠) 때 CSS 와 어긋난다.
     랜딩은 사이드바가 없어 nav 가 전 폭에서 드로어. */
  var mqNavDrawer = window.matchMedia("(width <= 52em)");
  var mqTocDrawer = window.matchMedia("(width <= 75em)");
  function navIsDrawer() { return pageType !== "topic" || mqNavDrawer.matches; }

  /* 드로어/검색 모달이 열려 있는 동안 문서 스크롤을 잠근다. */
  var searchOpenFlag = false;
  function syncScrollLock() {
    var drawerOpen = (navPanel && navPanel.classList.contains("open")) ||
      (tocPanel && tocPanel.classList.contains("open"));
    document.body.style.overflow = (drawerOpen || searchOpenFlag) ? "hidden" : "";
  }

  function closeMobileNav(restoreFocus) {
    if (!navPanel || !navPanel.classList.contains("open")) return;
    navPanel.classList.remove("open");
    navBackdrop && navBackdrop.setAttribute("hidden", "");
    navToggle && navToggle.setAttribute("aria-expanded", "false");
    syncScrollLock();
    if (restoreFocus && navToggle) navToggle.focus();
  }

  function openMobileNav() {
    if (!navPanel || !navIsDrawer()) return;
    closeToc();
    navPanel.classList.add("open");
    navBackdrop && navBackdrop.removeAttribute("hidden");
    navToggle && navToggle.setAttribute("aria-expanded", "true");
    syncScrollLock();
    if (navClose) navClose.focus();
  }

  function highlightCode() {
    if (typeof Prism === "undefined") return;
    if (!viewportEl) return;
    var blocks = viewportEl.querySelectorAll("pre code");
    if (!blocks.length) return;
    var arr = Array.from(blocks);
    var i = 0;
    var CHUNK = 8;
    function processChunk() {
      var end = Math.min(i + CHUNK, arr.length);
      for (; i < end; i++) {
        if (arr[i].getAttribute("data-highlighted") === "1") continue;
        Prism.highlightElement(arr[i]);
        arr[i].setAttribute("data-highlighted", "1");
      }
      if (i < arr.length) requestAnimationFrame(processChunk);
    }
    requestAnimationFrame(processChunk);
  }

  /* ── Copy code button (event delegation) ──
     마크업은 lib/markdown.js: .code-block > .code-head > button.copy-code-btn. 피드백은 버튼 글자를 잠깐 바꾼다. */
  var COPY_LABEL = "복사";
  var COPY_FEEDBACK_MS = 1600;

  document.addEventListener("click", async function (e) {
    var btn = e.target.closest(".copy-code-btn");
    if (!btn) return;
    var block = btn.closest(".code-block");
    var code = block && block.querySelector("code");
    if (!code) return;
    var text = code.innerText;

    function show(msg, ok) {
      btn.textContent = msg;
      btn.classList.toggle("copied", ok);
      clearTimeout(btn._copyTimer);
      btn._copyTimer = setTimeout(function () {
        btn.textContent = COPY_LABEL;
        btn.classList.remove("copied");
      }, COPY_FEEDBACK_MS);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        show("복사됨", true);
        return;
      } catch (err) { /* fall through */ }
    }
    try {
      var range = document.createRange();
      range.selectNode(code);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      var ok = document.execCommand("copy");
      sel.removeAllRanges();
      show(ok ? "복사됨" : "Ctrl+C로 복사해 주세요", ok);
    } catch (err) {
      show("Ctrl+C로 복사해 주세요", false);
    }
  });

  /* ── TOC ──
     목록은 [data-toc-list] 컨테이너마다 렌더한다: 오른쪽 열/드로어(#toc-panel)와 ≤75em 용 인라인 접이식(details.toc-inline).
     항목 = 섹션 h2 + 그 안의 h3/h4. 항목마다 data-toc-key 로 tocEntries(문서 순서)와 연결해 클릭 이동·스크롤스파이에 쓴다. */
  var tocEntries = [];   // { el, heading } — 문서 순서
  var tocActiveKey = -1;

  function findSectionEl(sec) {
    return document.getElementById(topicSlug + "-" + sec.id);
  }

  // 같은 id 의 헤딩이 섹션마다 있을 수 있어(섹션별로 slug 를 만든다) 항목이 속한 섹션 안에서 찾는다.
  function findHeadingEl(secEl, heading) {
    return secEl ? secEl.querySelector('[id="' + heading.id + '"]') : null;
  }

  function buildTocList() {
    var ul = document.createElement("ul");
    ul.className = "toc-items";
    tocEntries.forEach(function (entry, key) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.className = entry.depth >= 3 ? "toc toc-l3" : "toc";
      a.href = entry.href;
      a.dataset.tocKey = key;
      a.textContent = entry.text;
      li.appendChild(a);
      ul.appendChild(li);
    });
    return ul;
  }

  function initToc(sections) {
    tocEntries = [];
    (sections || []).forEach(function (sec) {
      var secEl = findSectionEl(sec);
      if (!secEl) return;
      tocEntries.push({
        el: secEl.querySelector(".topic-section-title") || secEl,
        text: sec.title,
        depth: 2,
        href: "#" + topicSlug + "-" + sec.id,
        flash: false,
      });
      (sec.headings || []).forEach(function (h) {
        if (h.depth < 3) return; // 맨 앞 가상 h2(섹션 제목)는 위에서 처리
        var hEl = findHeadingEl(secEl, h);
        if (!hEl) return;
        tocEntries.push({ el: hEl, text: h.text, depth: h.depth, href: "#" + topicSlug + "-" + h.id, flash: true });
      });
    });

    var containers = document.querySelectorAll("[data-toc-list]");
    containers.forEach(function (c) {
      c.innerHTML = "";
      if (tocEntries.length) c.appendChild(buildTocList());
    });
    var inline = document.getElementById("toc-inline");
    if (inline) inline.hidden = tocEntries.length === 0;
    if (tocToggleBtn) tocToggleBtn.hidden = tocEntries.length === 0;
    if (tocPanel) tocPanel.classList.toggle("is-empty", tocEntries.length === 0);
    updateScrollSpy();
  }

  /* ── TOC drawer (≤75em; 그 위에서는 오른쪽 열이 상시 보인다) ── */
  var tocClose = document.getElementById("toc-close");

  function closeToc(restoreFocus) {
    if (!tocPanel || !tocPanel.classList.contains("open")) return;
    tocPanel.classList.remove("open");
    tocToggleBtn && tocToggleBtn.setAttribute("aria-expanded", "false");
    tocBackdrop && tocBackdrop.setAttribute("hidden", "");
    syncScrollLock();
    if (restoreFocus && tocToggleBtn) tocToggleBtn.focus();
  }

  function openToc() {
    if (!tocPanel || !mqTocDrawer.matches) return;
    closeMobileNav();
    tocPanel.classList.add("open");
    tocToggleBtn && tocToggleBtn.setAttribute("aria-expanded", "true");
    tocBackdrop && tocBackdrop.removeAttribute("hidden");
    syncScrollLock();
    if (tocClose) tocClose.focus();
  }

  tocToggleBtn && tocToggleBtn.addEventListener("click", function () {
    if (tocPanel && tocPanel.classList.contains("open")) closeToc(true);
    else openToc();
  });
  tocClose && tocClose.addEventListener("click", function () { closeToc(true); });
  tocBackdrop && tocBackdrop.addEventListener("click", function () { closeToc(true); });

  // TOC 클릭: 문서(window) 스크롤로 해당 요소 위치까지 부드럽게 이동.
  var SCROLL_OFFSET_REM = 1;
  function scrollToWithin(el) {
    if (!el) return;
    var offset = SCROLL_OFFSET_REM * parseFloat(getComputedStyle(document.documentElement).fontSize);
    var top = el.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  document.addEventListener("click", function (e) {
    var a = e.target.closest("a[data-toc-key]");
    if (!a) return;
    var entry = tocEntries[parseInt(a.dataset.tocKey, 10)];
    if (!entry) return;
    e.preventDefault();
    closeToc();
    scrollToWithin(entry.el);
    if (entry.flash) {
      entry.el.classList.add("anchor-flash");
      setTimeout(function () { entry.el.classList.remove("anchor-flash"); }, 1500);
    }
  });

  document.addEventListener("click", function (e) {
    if (!e.target.closest("[data-toc-top]")) return;
    closeToc();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  /* ── Scroll-spy ──
     뷰포트 위쪽 30% 선을 지난 마지막 헤딩이 현재 위치. 페이지 맨 아래에서는 마지막 항목.
     스크롤/리사이즈를 rAF 로 묶어 계산한다 — 항목이 수십 개라 getBoundingClientRect 비용은 무시할 수준. */
  var spyFrame = 0;
  var SPY_LINE = 0.3;

  function setActiveToc(key) {
    if (key === tocActiveKey) return;
    tocActiveKey = key;
    document.querySelectorAll("a[data-toc-key].active").forEach(function (a) {
      a.classList.remove("active");
      a.removeAttribute("aria-current");
    });
    if (key < 0) return;
    document.querySelectorAll('a[data-toc-key="' + key + '"]').forEach(function (a) {
      a.classList.add("active");
      a.setAttribute("aria-current", "location");
      // 스티키 TOC 열이 스스로 스크롤될 때만 활성 항목이 보이도록 맞춘다(문서 스크롤은 건드리지 않음).
      var panel = a.closest(".toc-panel");
      if (panel && panel.scrollHeight > panel.clientHeight) {
        var pr = panel.getBoundingClientRect();
        var ar = a.getBoundingClientRect();
        if (ar.top < pr.top + 48) panel.scrollTop -= pr.top + 48 - ar.top;
        else if (ar.bottom > pr.bottom - 48) panel.scrollTop += ar.bottom - (pr.bottom - 48);
      }
    });
  }

  function updateScrollSpy() {
    spyFrame = 0;
    if (!tocEntries.length) return;
    var line = window.innerHeight * SPY_LINE;
    var active = -1;
    for (var i = 0; i < tocEntries.length; i++) {
      if (tocEntries[i].el.getBoundingClientRect().top <= line) active = i;
      else break;
    }
    var atBottom = window.pageYOffset > 0 &&
      window.innerHeight + window.pageYOffset >= document.documentElement.scrollHeight - 2;
    if (atBottom) active = tocEntries.length - 1;
    setActiveToc(active);
  }

  function requestScrollSpy() {
    if (!spyFrame) spyFrame = requestAnimationFrame(updateScrollSpy);
  }

  if (pageType === "topic") {
    window.addEventListener("scroll", requestScrollSpy, { passive: true });
    window.addEventListener("resize", requestScrollSpy);
    window.addEventListener("load", requestScrollSpy);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(requestScrollSpy);
  }

  /* ── Nav panel scroll save/restore ──
     왼쪽 카테고리(nav-panel) 스크롤 위치를 localStorage에 저장.
     저장 시점: nav 내부 링크 클릭(토픽/랜딩 이동) 직전 + pagehide.
     복원 시점: 페이지 진입 시. 저장 위치가 없으면 active 버튼으로 스크롤(fallback).
  */
  var NAV_SCROLL_KEY = STORAGE_PREFIX + "-nav-scroll";

  function getNavScroll() {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(NAV_SCROLL_KEY)); } catch (e) {}
    return typeof v === "number" && isFinite(v) ? v : null;
  }
  function saveNavScroll(top) {
    try { localStorage.setItem(NAV_SCROLL_KEY, JSON.stringify(top)); }
    catch (e) {}
  }

  /* ── Nav active state ──
     active 토픽 버튼 표시 + 포함 그룹이 접혀 있으면 펼치고,
     nav-panel 스크롤을 저장 위치로 복원(없으면 active 버튼이 보이도록 스크롤).
  */
  function scrollActiveNavIntoView(btn) {
    if (!navPanel || !btn) return;
    var btnRect = btn.getBoundingClientRect();
    var panelRect = navPanel.getBoundingClientRect();
    var margin = 12;
    if (btnRect.top < panelRect.top + margin) {
      navPanel.scrollTop -= panelRect.top + margin - btnRect.top;
    } else if (btnRect.bottom > panelRect.bottom - margin) {
      navPanel.scrollTop += btnRect.bottom - (panelRect.bottom - margin);
    }
  }

  function setActiveNav() {
    if (!topicSlug) return;
    var activeBtn = null;
    document.querySelectorAll(".topic-btn").forEach(function (btn) {
      var isActive = btn.dataset.topic === topicSlug;
      btn.classList.toggle("active", isActive);
      if (isActive) activeBtn = btn;
    });

    if (!activeBtn || !navPanel) return;

    // 저장된 nav 스크롤이 있으면 이미 복원됐으므로(applyCollapsed 직후 즉시 적용)
    // 그룹 펼치기/스크롤을 건드리지 않고 active 표시만. 사용자가 마지막으로 본 위치 보존.
    if (getNavScroll() != null) return;

    // 저장 위치가 없을 때만: active 토픽이 접힌 그룹 안이면 펼친다.
    var group = activeBtn.closest(".nav-group");
    if (group && group.classList.contains("collapsed")) {
      var id = group.dataset.groupId;
      if (id) {
        var set = new Set(getCollapsed());
        if (set.has(id)) {
          set.delete(id);
          setCollapsed(Array.from(set));
          applyCollapsed();
        }
      }
    }

    // 펼치기 적용 후 레이아웃 갱신을 거쳐 스크롤(정확한 위치 계산).
    // 저장 위치 없을 때만 실행되므로 fallback 경로.
    requestAnimationFrame(function () {
      scrollActiveNavIntoView(activeBtn);
    });
  }

  // nav 내부 링크 클릭 시 현재 nav 스크롤 저장 (토픽/랜딩 이동 전).
  // 외부 레퍼런스(target=_blank)는 같은 탭 이탈이 아니므로 제외.
  if (navPanel) {
    navPanel.addEventListener("click", function () {
      saveNavScroll(navPanel.scrollTop);
    });
  }
  // pagehide 보조: 새로고침/뒤로가기/검색 결과/주소 직접 입력 등 nav 클릭이 아닌 이탈 커버.
  if (navPanel) {
    window.addEventListener("pagehide", function () {
      saveNavScroll(navPanel.scrollTop);
    });
  }

  /* ── Flowchart layout ──
     Measure HTML nodes and labels, then let Dagre position the whole graph and
     route every edge. The canvas scrolls as one unit; nodes never wrap into a
     different rank. Font changes and resizing rerun the same layout. */
  var flowchartRedrawAll = null;

  function initFlowchartEdges() {
    if (typeof dagre === "undefined") return;
    var diagrams = Array.from(document.querySelectorAll(".flowchart-diagram"));
    if (!diagrams.length) return;
    var SVGNS = "http://www.w3.org/2000/svg";
    var drawFns = [];

    diagrams.forEach(function (root, di) {
      var canvas = root.querySelector(".fc-canvas");
      if (!canvas) return;
      var nodeEls = Array.from(canvas.querySelectorAll(".fc-node"));
      var groupEls = Array.from(canvas.querySelectorAll(".fc-group"));
      var nodes = new Map(nodeEls.map(function (el) { return [el.dataset.fcId, el]; }));
      var edges = Array.from(root.querySelectorAll(".fc-conn[data-from][data-to]")).map(function (conn) {
        return { from: conn.dataset.from, to: conn.dataset.to, label: conn.querySelector(".fc-conn-label") };
      });
      var svg = document.createElementNS(SVGNS, "svg");
      svg.setAttribute("class", "fc-edges");
      svg.setAttribute("aria-hidden", "true");
      var markerId = "fc-edge-head-" + di;
      var defs = document.createElementNS(SVGNS, "defs");
      var marker = document.createElementNS(SVGNS, "marker");
      marker.setAttribute("id", markerId);
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "9");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerWidth", "6");
      marker.setAttribute("markerHeight", "6");
      marker.setAttribute("orient", "auto");
      var head = document.createElementNS(SVGNS, "path");
      head.setAttribute("d", "M 0 1 L 9 5 L 0 9 z");
      head.setAttribute("class", "fc-edge-head");
      marker.appendChild(head);
      defs.appendChild(marker);
      svg.appendChild(defs);
      canvas.prepend(svg);

      var labelLayer = document.createElement("div");
      labelLayer.className = "fc-edge-labels";
      labelLayer.setAttribute("aria-hidden", "true");
      canvas.appendChild(labelLayer);
      edges.forEach(function (edge) {
        if (!edge.label) return;
        edge.label = edge.label.cloneNode(true);
        labelLayer.appendChild(edge.label);
      });

      function routePorts(edge, graph, points, fontSize) {
        if (edge.from === edge.to || points.length < 3) return points;
        var horizontal = /^(LR|RL)$/.test(root.dataset.fcDirection);
        var firstBend = points[1];
        var lastBend = points[points.length - 2];
        function port(id, endpoint, bend) {
          var node = graph.node(id);
          var radius = nodes.get(id).classList.contains("fc-round") ? Math.min(node.width, node.height) / 2 : fontSize / 2;
          var span = horizontal ? node.height : node.width;
          var half = Math.max(0, span / 2 - radius);
          var center = horizontal ? node.y : node.x;
          var offset = Math.max(center - half, Math.min(center + half, horizontal ? endpoint.y : endpoint.x));
          if (horizontal) return { x: node.x + (bend.x >= node.x ? 1 : -1) * node.width / 2, y: offset };
          return { x: offset, y: node.y + (bend.y >= node.y ? 1 : -1) * node.height / 2 };
        }
        var from = port(edge.from, points[0], firstBend);
        var to = port(edge.to, points[points.length - 1], lastBend);
        // Dagre's diagonal boundary intersections can cut across a taller peer
        // in the same rank. Leave and enter along the rank axis, turning only
        // in the reserved gaps; keep the intermediate lanes for skip/back edges.
        return [from, horizontal ? { x: firstBend.x, y: from.y } : { x: from.x, y: firstBend.y }]
          .concat(points.slice(1, -1), [horizontal ? { x: lastBend.x, y: to.y } : { x: to.x, y: lastBend.y }, to]);
      }

      var rankColumns = null;
      function sizeNodes(fontSize) {
        var count = rankColumns || 1;
        var room = (root.clientWidth - 2 * fontSize - (count - 1) * 1.5 * fontSize) / count;
        nodeEls.forEach(function (el) {
          el.style.maxWidth = Math.max(8 * fontSize, Math.min(26 * fontSize, Math.floor(room))) + "px";
        });
        return nodeEls.map(function (el) { return [el.offsetWidth, el.offsetHeight]; });
      }

      var lastMeasurements = "";
      function draw() {
        if (!root.clientWidth) return; // Hidden content is measured when it becomes visible.
        var fontSize = parseFloat(getComputedStyle(root).fontSize);
        root.classList.add("has-svg-edges");
        // offset dimensions stay in canvas coordinates, including during print scaling.
        var sizes = sizeNodes(fontSize);
        var labelSizes = edges.map(function (edge) { return edge.label ? [edge.label.offsetWidth, edge.label.offsetHeight] : [0, 0]; });
        var measurements = JSON.stringify([root.clientWidth, fontSize, sizes, labelSizes]);
        if (measurements === lastMeasurements) return;

        var graph = new dagre.graphlib.Graph({ multigraph: true, compound: true });
        graph.setGraph({
          rankdir: root.dataset.fcDirection || "TB",
          nodesep: 1.5 * fontSize, edgesep: fontSize, ranksep: 3 * fontSize,
          marginx: fontSize, marginy: fontSize,
        });
        nodeEls.forEach(function (el, index) {
          graph.setNode(el.dataset.fcId, { width: sizes[index][0], height: sizes[index][1] });
        });
        groupEls.forEach(function (el) { graph.setNode(el.dataset.fcId, {}); });
        nodeEls.concat(groupEls).forEach(function (el) {
          if (el.dataset.fcParent) graph.setParent(el.dataset.fcId, el.dataset.fcParent);
        });
        edges.forEach(function (edge, index) {
          graph.setEdge(edge.from, edge.to, {
            width: labelSizes[index][0], height: labelSizes[index][1], labelpos: "c",
          }, String(index));
        });
        try {
          dagre.layout(graph);
          // Use the widest vertical rank to budget node widths. Apply that
          // budget to every node so a later single node cannot widen a branch.
          // Wrap text inside nodes; keep ranks and their edges together.
          if (rankColumns === null && !/^(LR|RL)$/.test(root.dataset.fcDirection)) {
            var counts = new Map();
            nodeEls.forEach(function (el) {
              var y = graph.node(el.dataset.fcId).y;
              counts.set(y, (counts.get(y) || 0) + 1);
            });
            rankColumns = Math.max(1, ...counts.values());
            sizes = sizeNodes(fontSize);
            nodeEls.forEach(function (el, index) {
              var node = graph.node(el.dataset.fcId);
              node.width = sizes[index][0];
              node.height = sizes[index][1];
            });
            dagre.layout(graph);
          }
          // Compound borders reserve half a rank gap above their first node.
          // Measure titles at the computed group width, then reserve their space.
          var titleHeight = 0;
          groupEls.forEach(function (el) {
            el.style.width = graph.node(el.dataset.fcId).width + "px";
            titleHeight = Math.max(titleHeight, el.querySelector(".fc-group-label").offsetHeight);
          });
          if (groupEls.length) {
            graph.graph().ranksep = Math.max(3 * fontSize, titleHeight + fontSize);
            graph.graph().marginy = Math.max(fontSize, (titleHeight + fontSize) / 2);
            dagre.layout(graph);
          }
        } catch (error) {
          root.classList.remove("has-svg-edges");
          console.warn("Flowchart layout failed:", error);
          return;
        }

        var width = Math.ceil(graph.graph().width);
        var height = Math.ceil(graph.graph().height);
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";
        svg.setAttribute("viewBox", "0 0 " + width + " " + height);
        root.style.setProperty("--fc-print-scale", Math.min(1, root.clientWidth / width));
        nodes.forEach(function (el, id) {
          var node = graph.node(id);
          el.style.left = (node.x - node.width / 2) + "px";
          el.style.top = (node.y - node.height / 2) + "px";
        });
        groupEls.forEach(function (el) {
          var group = graph.node(el.dataset.fcId);
          el.style.left = (group.x - group.width / 2) + "px";
          el.style.top = (group.y - group.height / 2) + "px";
          el.style.width = group.width + "px";
          el.style.height = group.height + "px";
        });
        svg.querySelectorAll(".fc-edge-line").forEach(function (path) { path.remove(); });
        edges.forEach(function (edge, index) {
          var route = graph.edge(edge.from, edge.to, String(index));
          var path = document.createElementNS(SVGNS, "path");
          path.setAttribute("class", "fc-edge-line");
          path.setAttribute("data-from", edge.from);
          path.setAttribute("data-to", edge.to);
          path.setAttribute("d", routePorts(edge, graph, route.points, fontSize).map(function (point, i) {
            return (i ? "L " : "M ") + point.x + " " + point.y;
          }).join(" "));
          path.setAttribute("marker-end", "url(#" + markerId + ")");
          svg.appendChild(path);
          if (edge.label) {
            edge.label.style.left = route.x + "px";
            edge.label.style.top = route.y + "px";
          }
        });
        lastMeasurements = JSON.stringify([root.clientWidth, fontSize, sizes, labelSizes]);
      }

      var raf = 0;
      function scheduleDraw() {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(draw);
      }
      drawFns.push(draw);
      draw();
      if (typeof ResizeObserver !== "undefined") {
        var observer = new ResizeObserver(scheduleDraw);
        observer.observe(root);
        nodeEls.forEach(function (el) { observer.observe(el); });
      }
    });

    flowchartRedrawAll = function () { drawFns.forEach(function (draw) { draw(); }); };
    window.addEventListener("resize", function () { requestAnimationFrame(flowchartRedrawAll); });
    window.addEventListener("beforeprint", flowchartRedrawAll);
    window.addEventListener("afterprint", flowchartRedrawAll);
    if (document.fonts) {
      document.fonts.ready.then(flowchartRedrawAll);
      document.fonts.addEventListener("loadingdone", flowchartRedrawAll);
    }
  }

  initFlowchartEdges();

  /* ── Nav toggle ── */
  navToggle && navToggle.addEventListener("click", function () {
    if (navPanel && navPanel.classList.contains("open")) closeMobileNav(true);
    else openMobileNav();
  });
  navClose && navClose.addEventListener("click", function () { closeMobileNav(true); });
  navBackdrop && navBackdrop.addEventListener("click", function () { closeMobileNav(true); });
  // 드로어 안에서 링크를 눌러 이동하면 닫는다(같은 문서 내 이동은 아니므로 사실상 페이지 전환).
  navPanel && navPanel.addEventListener("click", function (e) {
    if (e.target.closest("a.topic-btn")) closeMobileNav();
  });

  /* ── Sidebar nav group collapse ── */
  var navGroupsEl = document.querySelectorAll(".nav-group");
  var COLLAPSE_KEY = STORAGE_PREFIX + "-collapsed-groups";
  function getCollapsed() {
    try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function setCollapsed(arr) {
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(arr)); }
    catch (e) {}
  }
  function applyCollapsed() {
    var collapsed = new Set(getCollapsed());
    navGroupsEl.forEach(function (g, i) {
      var id = g.dataset.groupId || String(i);
      g.classList.toggle("collapsed", collapsed.has(id));
      var label = g.querySelector(".nav-group-label");
      if (label) label.setAttribute("aria-expanded", String(!collapsed.has(id)));
    });
  }
  applyCollapsed();
  // 저장된 nav 스크롤이 있으면 첫 페인트 전에 즉시 복원(깜빡임 방지).
  // active 토픽이 접힌 그룹 안이면 먼저 펼친 뒤 스크롤 적용.
  if (navPanel && pageType === "topic" && topicSlug) {
    var savedNavScroll = getNavScroll();
    if (savedNavScroll != null) {
      var activeBtn0 = document.querySelector('.topic-btn[data-topic="' + topicSlug + '"]');
      var group0 = activeBtn0 ? activeBtn0.closest(".nav-group") : null;
      if (group0 && group0.classList.contains("collapsed")) {
        var id0 = group0.dataset.groupId;
        if (id0) {
          var set0 = new Set(getCollapsed());
          if (set0.has(id0)) {
            set0.delete(id0);
            setCollapsed(Array.from(set0));
            applyCollapsed();
          }
        }
      }
      navPanel.scrollTop = savedNavScroll;
    }
  }
  navGroupsEl.forEach(function (g, i) {
    var label = g.querySelector(".nav-group-label");
    if (!label) return;
    var id = g.dataset.groupId || String(i);
    label.addEventListener("click", function (e) {
      e.preventDefault();
      var arr = getCollapsed();
      var set = new Set(arr);
      if (set.has(id)) set.delete(id); else set.add(id);
      setCollapsed(Array.from(set));
      applyCollapsed();
    });
  });

  /* ── 주제 필터 ──
     공백으로 나눈 모든 단어가 (주제 이름 + 요약) 에 부분 일치해야 보인다(대소문자 무시).
     매치가 없는 그룹은 숨기고, 필터 중에는 접힌 그룹도 펼쳐서 보여 준다(CSS .is-filtering). */
  var filterInput = document.getElementById("nav-filter-input");
  var filterEmpty = document.getElementById("nav-filter-empty");

  function applyFilter() {
    if (!navPanel || !filterInput) return;
    var words = filterInput.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    navPanel.classList.toggle("is-filtering", words.length > 0);
    var anyVisible = false;
    navGroupsEl.forEach(function (g) {
      var visibleInGroup = 0;
      g.querySelectorAll(".topic-btn").forEach(function (btn) {
        var labelEl = btn.querySelector(".topic-btn-label");
        var hay = ((labelEl ? labelEl.textContent : "") + " " + (btn.getAttribute("title") || "")).toLowerCase();
        var match = words.every(function (w) { return hay.indexOf(w) !== -1; });
        btn.hidden = !match;
        if (match) visibleInGroup++;
      });
      g.hidden = visibleInGroup === 0;
      if (visibleInGroup > 0) anyVisible = true;
    });
    if (filterEmpty) filterEmpty.hidden = anyVisible || words.length === 0;
  }

  if (filterInput) {
    filterInput.addEventListener("input", function () {
      applyFilter();
      navPanel.scrollTop = 0;
    });
    filterInput.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (filterInput.value) {
        filterInput.value = "";
        applyFilter();
      } else {
        filterInput.blur();
      }
    });
  }

  /* ── Boot: topic page ── */
  if (pageType === "topic" && topicSlug) {
    var topicDataEl = document.getElementById("topic-data");
    if (topicDataEl) {
      try {
        var topicData = JSON.parse(topicDataEl.textContent);
        initToc(topicData.sections);
      } catch (e) {
        // topic-data parse error — TOC stays empty
      }
    }
    setActiveNav();
    highlightCode();
    restoreTopicScroll(topicSlug);
  }

  // 콘텐츠(KaTeX/Prism/이미지) 렌더링 완료 후 한 번 더 복원 시도.
  // rAF 기반 폴링이 load보다 빨리 끝나 브라우저가 0으로 리셋하는 경우 보정.
  if (viewportEl && pageType === "topic" && topicSlug) {
    window.addEventListener("load", function () {
      setTimeout(function () { restoreTopicScroll(topicSlug); }, 0);
    });
  }

  /* ── Per-topic content scroll save/restore ──
     토픽별 본문(콘텐츠 뷰포트) 스크롤 위치를 localStorage에 저장.
     같은 토픽으로 다시 들어오면 복원. 해시가 있으면 해시 우선.
  */
  var SCROLL_KEY = STORAGE_PREFIX + "-scroll";
  var SCROLL_DEBOUNCE_MS = 220;
  var scrollSaveTimer = null;

  function getScrollMap() {
    try { return JSON.parse(localStorage.getItem(SCROLL_KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function setScrollMap(map) {
    try { localStorage.setItem(SCROLL_KEY, JSON.stringify(map)); }
    catch (e) {}
  }
  function saveTopicScroll(slug, top) {
    if (!slug) return;
    var map = getScrollMap();
    map[slug] = top;
    setScrollMap(map);
  }

  function restoreTopicScroll(slug) {
    if (!viewportEl || !slug) return;
    // 해시로 직접 진입한 경우: 대상 요소가 있으면 해시 우선, 없으면 저장 위치 복원.
    if (location.hash) {
      var hashTarget = document.getElementById(location.hash.slice(1));
      if (hashTarget) return;
    }
    var map = getScrollMap();
    var top = map[slug];
    if (typeof top !== "number" || !isFinite(top) || top <= 0) return;

    // 콘텐츠(Prism/KaTeX/이미지)가 렌더링되어 scrollHeight가 충분히 커진 뒤 복원.
    // 준비되지 않았으면 폴링하며 대기(최대 ~2s).
    var tries = 0;
    var MAX_TRIES = 20;
    function attempt() {
      tries++;
      // 일부러 여유를 둬서 대략 그 위치 근처까지 콘텐츠가 펼쳐졌는지 확인
      if (document.documentElement.scrollHeight < top + window.innerHeight && tries < MAX_TRIES) {
        requestAnimationFrame(attempt);
        return;
      }
      window.scrollTo({ top: top });
    }
    requestAnimationFrame(attempt);
  }

  if (viewportEl && pageType === "topic" && topicSlug) {
    window.addEventListener("scroll", function () {
      if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
      scrollSaveTimer = setTimeout(function () {
        saveTopicScroll(topicSlug, window.pageYOffset);
      }, SCROLL_DEBOUNCE_MS);
    }, { passive: true });
    // 페이지를 떠나기 직전 마지막 위치 저장 (디바운스 미처 저장 못한 경우 대비)
    window.addEventListener("pagehide", function () {
      if (scrollSaveTimer) {
        clearTimeout(scrollSaveTimer);
        scrollSaveTimer = null;
      }
      saveTopicScroll(topicSlug, window.pageYOffset);
    });
  }

  /* ── Search ── */
  var searchTrigger = document.getElementById("search-trigger");
  var searchModal = document.getElementById("search-modal");
  var searchBackdrop = document.getElementById("search-backdrop");
  var searchInput = document.getElementById("search-input");
  var searchResults = document.getElementById("search-results");

  var searchActiveIdx = -1;
  var searchLastQuery = "";
  var searchDebounceTimer = null;
  var _cachedRecords = null;
  var _fetchPromise = null;

  function searchModalIsOpen() {
    return searchModal && !searchModal.hasAttribute("hidden");
  }

  function openSearchModal() {
    if (!searchModal || !searchBackdrop) return;
    searchModal.removeAttribute("hidden");
    searchBackdrop.removeAttribute("hidden");
    searchOpenFlag = true;
    syncScrollLock();
    searchActiveIdx = -1;
    searchLastQuery = "";
    searchResults.innerHTML = '<li class="search-empty">키워드를 입력하세요</li>';
    setTimeout(function () { searchInput && searchInput.focus(); }, 50);
    // Prefetch search index when modal opens
    prefetchSearchIndex();
  }

  function closeSearchModal() {
    if (!searchModal || !searchBackdrop) return;
    searchModal.setAttribute("hidden", "");
    searchBackdrop.setAttribute("hidden", "");
    searchOpenFlag = false;
    syncScrollLock();
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  }

  function prefetchSearchIndex() {
    if (_cachedRecords || _fetchPromise) return;
    _fetchPromise = fetch(searchIndexUrl)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        _cachedRecords = data.records || [];
        _fetchPromise = null;
      })
      .catch(function () {
        _cachedRecords = [];
        _fetchPromise = null;
      });
  }

  function getRecords() {
    return _cachedRecords || [];
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function escapeAttr(text) {
    return String(text).replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  // Intl.Segmenter for Korean tokenization
  var koSegmenter = typeof Intl !== "undefined" && Intl.Segmenter
    ? new Intl.Segmenter("ko", { granularity: "word" })
    : null;

  function tokenize(text) {
    var set = {};
    var str = String(text || "");
    var ascii = str.match(/[A-Za-z][A-Za-z0-9_]*/g);
    if (ascii) for (var i = 0; i < ascii.length; i++) set[ascii[i].toLowerCase()] = true;
    if (koSegmenter) {
      var segments = koSegmenter.segment(str);
      for (var seg of segments) {
        if (seg.isWordLike && /[\uAC00-\uD7AF]/.test(seg.segment)) {
          set[seg.segment] = true;
        }
      }
    } else {
      var ko = str.match(/[\uAC00-\uD7AF]+/g);
      if (ko) for (var j = 0; j < ko.length; j++) set[ko[j]] = true;
    }
    return Object.keys(set);
  }

  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function searchRecords(query, records) {
    var tokens = tokenize(query).map(function (t) { return t.toLowerCase(); }).filter(Boolean);
    if (!tokens.length) return [];
    return records
      .map(function (r) {
        var sectionLower = r.sectionTitle.toLowerCase();
        var bodyLower = r.body.toLowerCase();
        var score = 0;
        for (var i = 0; i < tokens.length; i++) {
          var t = tokens[i];
          if (sectionLower.indexOf(t) !== -1) score += 10;
          var re = new RegExp(escapeRegex(t), "g");
          var matches = bodyLower.match(re);
          if (matches) score += matches.length;
        }
        return score > 0 ? { r: r, score: score } : null;
      })
      .filter(Boolean)
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 12)
      .map(function (x) { return x.r; });
  }

  function renderEmpty(msg) {
    searchResults.innerHTML = "<li class=\"search-empty\">" + escapeHtml(msg) + "</li>";
    searchActiveIdx = -1;
  }

  function setActive(i) {
    var items = searchResults.querySelectorAll(".search-result");
    if (!items.length) return;
    searchActiveIdx = ((i % items.length) + items.length) % items.length;
    items.forEach(function (el, j) {
      el.classList.toggle("active", j === searchActiveIdx);
      el.setAttribute("aria-selected", String(j === searchActiveIdx));
      if (j === searchActiveIdx) el.scrollIntoView({ block: "nearest" });
    });
  }

  function makeSnippet(body, query) {
    var lower = body.toLowerCase();
    var idx = lower.indexOf(query.toLowerCase());
    if (idx === -1) return null;
    var start = Math.max(0, idx - 60);
    var end = Math.min(body.length, idx + query.length + 60);
    var s = body.slice(start, end);
    if (start > 0) s = "\u2026" + s;
    if (end < body.length) s = s + "\u2026";
    return highlightMatch(s, query);
  }

  function highlightMatch(text, query) {
    var escaped = escapeHtml(text);
    var re = new RegExp("(" + query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
    return escaped.replace(re, "<mark>$1</mark>");
  }

  function renderSearchResults(results, query) {
    searchResults.innerHTML = results
      .map(function (r, i) {
        var chain = [];
        if (r.topicGroup) chain.push(r.topicGroup);
        chain.push(r.topicTitle);
        chain.push(r.sectionTitle);
        var breadcrumb = chain.filter(Boolean).join(" \u203A ");
        var snippet = makeSnippet(r.body, query);
        var snippetHtml = snippet
          ? '<div class="search-result-snippet">' + snippet + "</div>"
          : "";
        return (
          '<li role="option" id="search-result-' +
          i +
          '" class="search-result" data-slug="' +
          escapeAttr(r.topicSlug) +
          '" data-section="' +
          escapeAttr(r.sectionId) +
          '" aria-selected="false">' +
          '<div class="search-result-title">' +
          escapeHtml(r.sectionTitle) +
          "</div>" +
          '<div class="search-result-breadcrumb">' +
          escapeHtml(breadcrumb) +
          "</div>" +
          snippetHtml +
          "</li>"
        );
      })
      .join("");
    if (results.length) setActive(0);
  }

  function runSearch() {
    var query = searchInput.value.trim();
    searchLastQuery = query;
    if (!query) {
      renderEmpty("키워드를 입력하세요");
      return;
    }
    if (!getRecords().length && _fetchPromise) {
      renderEmpty("검색 인덱스 로딩 중...");
      _fetchPromise.then(function () {
        if (searchInput.value.trim() === query) runSearch();
      });
      return;
    }
    var records = getRecords();
    var results = searchRecords(query, records);
    if (!results.length) {
      renderEmpty("결과 없음");
      return;
    }
    renderSearchResults(results, query);
  }

  function navigateToResult(targetSlug, sectionId) {
    closeSearchModal();
    // search-index.json 은 사이트 루트에 있다 — 같은 접두(절대 baseUrl / ../ / 빈 문자열)로 토픽 URL 을 만든다.
    var siteRoot = searchIndexUrl.replace(/search-index\.json$/, "");
    var url = siteRoot + "topics/" + encodeURIComponent(targetSlug) + ".html";
    if (sectionId) url += "#" + targetSlug + "-" + sectionId;
    location.href = url;
  }

  // Click on search trigger
  searchTrigger && searchTrigger.addEventListener("click", openSearchModal);

  // Backdrop click -> close
  searchBackdrop && searchBackdrop.addEventListener("click", closeSearchModal);

  // Close button (mobile)
  var searchCloseBtn = document.getElementById("search-close-btn");
  searchCloseBtn && searchCloseBtn.addEventListener("click", closeSearchModal);

  // Input handler with debounce
  searchInput && searchInput.addEventListener("input", function () {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(runSearch, 100);
  });

  // Keyboard inside modal
  searchModal && searchModal.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(searchActiveIdx + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(searchActiveIdx - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      var items = searchResults.querySelectorAll(".search-result");
      var target = items[searchActiveIdx];
      if (target) {
        navigateToResult(target.dataset.slug, target.dataset.section);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearchModal();
    }
  });

  // Click on a result item
  searchResults && searchResults.addEventListener("click", function (e) {
    var item = e.target.closest(".search-result");
    if (!item) return;
    navigateToResult(item.dataset.slug, item.dataset.section);
  });

  /* ── Global keyboard shortcuts ── */
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openSearchModal();
      return;
    }
    if (
      e.key === "/" &&
      !/^(input|textarea|select)$/i.test(e.target.tagName) &&
      !searchModalIsOpen()
    ) {
      e.preventDefault();
      openSearchModal();
    }
  });

  /* ── Escape key (global) ── */
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (e.target.matches && e.target.matches("input, textarea, select")) return;
    if (!(navPanel && navPanel.classList.contains("open")) && !(tocPanel && tocPanel.classList.contains("open"))) return;
    e.preventDefault();
    closeMobileNav(true);
    closeToc(true);
  });

  /* ── 폭 변화(창 크기 · 브라우저 확대) ──
     드로어 구간을 벗어나면 열린 드로어를 닫아 잠긴 스크롤·남은 백드롭이 없게 한다. */
  function onNavBreakpoint() { if (!navIsDrawer()) closeMobileNav(); }
  function onTocBreakpoint() { if (!mqTocDrawer.matches) closeToc(); }
  [[mqNavDrawer, onNavBreakpoint], [mqTocDrawer, onTocBreakpoint]].forEach(function (pair) {
    if (pair[0].addEventListener) pair[0].addEventListener("change", pair[1]);
    else pair[0].addListener(pair[1]);
  });

  /* ── Lazy prefetch search index on boot (idle) ── */
  (window.requestIdleCallback || function (cb) { setTimeout(cb, 500); })(function () {
    prefetchSearchIndex();
  });
})();
