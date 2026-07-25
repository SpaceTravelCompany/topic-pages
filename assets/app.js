(function () {
  "use strict";

  var pageType = document.body.dataset.pageType || "landing";
  var baseUrl = document.body.dataset.baseUrl || "";
  var topicSlug = document.body.dataset.topicSlug || "";
  var STORAGE_PREFIX = document.body.dataset.storagePrefix || "topic-pages";
  var searchIndexUrl = document.body.dataset.searchIndexUrl || "search-index.json";

  var viewportEl = document.getElementById("content-viewport");
  var navPanel = document.querySelector(".nav-panel");
  var navToggle = document.getElementById("nav-toggle");
  var navBackdrop = document.getElementById("nav-backdrop");
  var eyebrowEl = document.getElementById("topic-eyebrow");

  var THEME_KEY = STORAGE_PREFIX + "-theme";
  var themeToggleBtn = document.getElementById("theme-toggle");

  /* ── Theme ── */
  function getTheme() {
    return document.documentElement.dataset.theme === "light" ? "light" : "dark";
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    themeToggleBtn && themeToggleBtn.setAttribute(
      "aria-label",
      theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환",
    );
  }

  function closeMobileNav() {
    navPanel && navPanel.classList.remove("open");
    navBackdrop && navBackdrop.setAttribute("hidden", "");
  }

  function openMobileNav() {
    navPanel && navPanel.classList.add("open");
    navBackdrop && navBackdrop.removeAttribute("hidden");
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

  /* ── Copy code button (event delegation) ── */
  document.addEventListener("click", async function (e) {
    var btn = e.target.closest(".copy-code-btn");
    if (!btn) return;
    var toolbar = btn.closest(".code-toolbar");
    if (!toolbar) return;
    var code = toolbar.querySelector("code");
    var text = code ? code.innerText : "";
    var toast = toolbar.querySelector(".copy-toast");

    function show(msg, ok) {
      if (!toast) return;
      toast.textContent = msg;
      toast.classList.add("show");
      btn.classList.toggle("success", ok);
      setTimeout(function () {
        toast.classList.remove("show");
        btn.classList.remove("success");
      }, 1600);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        show("복사됨", true);
        return;
      } catch (e) { /* fall through */ }
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
    } catch (e) {
      show("Ctrl+C로 복사해 주세요", false);
    }
  });

  /* ── TOC (section-per-view model) ──
     Each TOC anchor links to the section element (id = {slug}-{sectionId}).
     Click handler prevents default and uses smooth scroll.
  */
  var tocSections = null;

  function clearToc() {
    tocSections = null;
    var panel = document.getElementById("toc-panel");
    if (panel) panel.innerHTML = "";
  }

  function initToc(sections) {
    tocSections = sections;
    var panel = document.getElementById("toc-panel");
    if (!panel) return;
    panel.innerHTML = "";
    if (!sections || sections.length === 0) return;

    var ul = document.createElement("ul");

    sections.forEach(function (sec, i) {
      // Section h2
      var li = document.createElement("li");
      li.className = "depth-2";
      var a = document.createElement("a");
      a.href = "#" + topicSlug + "-" + sec.id;
      a.dataset.sectionIdx = i;
      a.dataset.tocTarget = sec.id;
      a.textContent = sec.title;
      li.appendChild(a);
      ul.appendChild(li);

      // h3/h4 within section
      if (sec.headings) {
        sec.headings.forEach(function (h) {
          if (h.depth < 3) return; // skip the virtual h2
          var subLi = document.createElement("li");
          subLi.className = "depth-" + h.depth;
          var subA = document.createElement("a");
          subA.href = "#" + topicSlug + "-" + h.id;
          subA.dataset.sectionIdx = i;
          subA.dataset.headingId = h.id;
          subA.textContent = h.text;
          subLi.appendChild(subA);
          ul.appendChild(subLi);
        });
      }
    });

    panel.appendChild(ul);
  }

  /* ── TOC toggle ── */
  var tocToggleBtn = document.getElementById("toc-toggle");
  var tocPanel = document.getElementById("toc-panel");
  var tocBackdrop = document.getElementById("toc-backdrop");

  function closeToc() {
    tocPanel && tocPanel.classList.remove("open");
    tocToggleBtn && tocToggleBtn.setAttribute("aria-expanded", "false");
    tocBackdrop && tocBackdrop.setAttribute("hidden", "");
  }

  tocToggleBtn && tocToggleBtn.addEventListener("click", function () {
    var expanded = tocToggleBtn.getAttribute("aria-expanded") === "true";
    tocToggleBtn.setAttribute("aria-expanded", String(!expanded));
    tocPanel && tocPanel.classList.toggle("open", !expanded);
    if (expanded) {
      tocBackdrop && tocBackdrop.setAttribute("hidden", "");
    } else {
      tocBackdrop && tocBackdrop.removeAttribute("hidden");
    }
  });

  tocBackdrop && tocBackdrop.addEventListener("click", closeToc);

  // TOC click handler: smooth scroll to section
  tocPanel && tocPanel.addEventListener("click", function (e) {
    var a = e.target.closest("a[data-section-idx]");
    if (!a) return;
    e.preventDefault();
    var idx = parseInt(a.dataset.sectionIdx, 10);
    var sec = tocSections && tocSections[idx];
    if (!sec) return;
    var targetId = topicSlug + "-" + sec.id;
    var el = document.getElementById(targetId);
    if (el) {
      el.scrollIntoView({ block: "start", behavior: "smooth" });
    }
    var headingId = a.dataset.headingId;
    if (headingId) {
      requestAnimationFrame(function () {
        var hEl = document.getElementById(topicSlug + "-" + headingId);
        if (!hEl) hEl = document.getElementById(headingId);
        if (hEl) {
          hEl.scrollIntoView({ block: "start", behavior: "smooth" });
          hEl.classList.add("anchor-flash");
          setTimeout(function () { hEl.classList.remove("anchor-flash"); }, 1500);
        }
      });
    }
  });

  /* ── Nav active state ── */
  function setActiveNav() {
    if (!topicSlug) return;
    var btns = document.querySelectorAll(".topic-btn");
    btns.forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.topic === topicSlug);
    });
  }

  /* ── Theme toggle ── */
  themeToggleBtn && themeToggleBtn.addEventListener("click", function () {
    setTheme(getTheme() === "dark" ? "light" : "dark");
    if (viewportEl) {
      viewportEl.querySelectorAll("pre code[data-highlighted]").forEach(function (el) {
        el.removeAttribute("data-highlighted");
      });
    }
    highlightCode();
  });
  setTheme(getTheme());

  /* ── Reader mode (font size toggle) ── */
  var READER_KEY = STORAGE_PREFIX + "-reader-size";
  var SIZES = ["sm", "base", "lg"];
  function getReaderSize() {
    var v = localStorage.getItem(READER_KEY);
    return SIZES.indexOf(v) !== -1 ? v : "sm";
  }
  function applyReaderSize(v) {
    if (viewportEl) viewportEl.setAttribute("data-reader-size", v);
    var landing = document.getElementById("content-viewport-landing");
    if (landing) landing.setAttribute("data-reader-size", v);
    localStorage.setItem(READER_KEY, v);
  }
  var readerToggleBtn = document.getElementById("reader-toggle");
  readerToggleBtn && readerToggleBtn.addEventListener("click", function () {
    var i = SIZES.indexOf(getReaderSize());
    applyReaderSize(SIZES[(i + 1) % SIZES.length]);
  });
  applyReaderSize(getReaderSize());

  /* ── Nav toggle ── */
  navToggle && navToggle.addEventListener("click", function () {
    if (navPanel && navPanel.classList.contains("open")) closeMobileNav();
    else openMobileNav();
  });
  navBackdrop && navBackdrop.addEventListener("click", closeMobileNav);

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
    });
  }
  applyCollapsed();
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
    document.body.style.overflow = "hidden";
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
    document.body.style.overflow = "";
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
    var url = (baseUrl || "") + "topics/" + encodeURIComponent(targetSlug) + ".html";
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
    if (e.target.matches("input, textarea, select")) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeMobileNav();
      closeToc();
    }
  });

  /* ── Resize handler ── */
  window.addEventListener("resize", function () {
    if (window.innerWidth > 800) closeMobileNav();
    if (window.innerWidth >= 1200) closeToc();
  });

  /* ── Lazy prefetch search index on boot (idle) ── */
  (window.requestIdleCallback || function (cb) { setTimeout(cb, 500); })(function () {
    prefetchSearchIndex();
  });
})();
