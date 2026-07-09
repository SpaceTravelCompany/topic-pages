(function () {
  const dataEl = document.getElementById("site-data");
  if (!dataEl) return;

  const { site, topics } = JSON.parse(dataEl.textContent);

  const eyebrowEl = document.getElementById("topic-eyebrow");
  const sectionTitleEl = document.getElementById("section-title");
  const viewportEl = document.getElementById("content-viewport");
  const counterEl = document.getElementById("sec-counter");
  const prevBtn = document.getElementById("sec-prev");
  const nextBtn = document.getElementById("sec-next");
  const navPanel = document.querySelector(".nav-panel");
  const navToggle = document.getElementById("nav-toggle");
  const navBackdrop = document.getElementById("nav-backdrop");
  const topicBtns = [...document.querySelectorAll(".topic-btn")];

  const STORAGE_PREFIX = (site && site.storagePrefix) || "topic-pages";
  const THEME_KEY = `${STORAGE_PREFIX}-theme`;
  const themeToggleBtn = document.getElementById("theme-toggle");

  const defaultTopic = site.sections[0]?.topics[0]?.slug ?? "";

  let currentTopic = defaultTopic;
  let currentSection = 0;

  function getTheme() {
    return document.documentElement.dataset.theme === "light" ? "light" : "dark";
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    themeToggleBtn?.setAttribute(
      "aria-label",
      theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환",
    );
  }

  function highlightCode() {
    if (typeof Prism === "undefined") return;
    const blocks = viewportEl.querySelectorAll("pre code");
    if (!blocks.length) return;
    const arr = Array.from(blocks);
    let i = 0;
    const CHUNK = 8;
    function processChunk() {
      const end = Math.min(i + CHUNK, arr.length);
      for (; i < end; i++) {
        Prism.highlightElement(arr[i]);
      }
      if (i < arr.length) {
        requestAnimationFrame(processChunk);
      }
    }
    requestAnimationFrame(processChunk);
  }

  function updateHash() {
    const topic = topics[currentTopic];
    const section = topic?.sections[currentSection];
    const hash = section ? `#${currentTopic}/${section.id}` : `#${currentTopic}`;
    if (location.hash !== hash) {
      history.replaceState(null, "", hash);
    }
  }

  function parseHash() {
    const raw = location.hash.replace(/^#/, "");
    if (!raw || raw === "_home") return { topic: defaultTopic, sectionId: null };

    const slash = raw.indexOf("/");
    if (slash === -1) return { topic: raw, sectionId: null };

    return {
      topic: raw.slice(0, slash),
      sectionId: raw.slice(slash + 1),
    };
  }

  function closeMobileNav() {
    navPanel?.classList.remove("open");
    navBackdrop?.setAttribute("hidden", "");
  }

  function openMobileNav() {
    navPanel?.classList.add("open");
    navBackdrop?.removeAttribute("hidden");
  }

  function setActiveNav() {
    topicBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.topic === currentTopic);
    });
  }

  function renderContent() {
    const topic = topics[currentTopic];
    if (!topic) return;

    const section = topic.sections[currentSection];
    if (!section) return;

    // Preserve scroll ratio across section navigation
    const prevHeight = viewportEl.scrollHeight || 1;
    const prevPct = viewportEl.scrollTop / prevHeight;

    viewportEl.innerHTML = section.html;

    // Restore scroll position by ratio, clamped to valid range
    const maxScroll = viewportEl.scrollHeight - viewportEl.clientHeight;
    viewportEl.scrollTop = maxScroll > 0
      ? Math.max(0, Math.min(maxScroll, prevPct * viewportEl.scrollHeight))
      : 0;

    // Defer code highlighting to next frame — user sees content immediately
    requestAnimationFrame(highlightCode);

    const total = topic.sections.length;
    counterEl.textContent = total ? `${currentSection + 1} / ${total}` : "";
    prevBtn.disabled = currentSection <= 0;
    nextBtn.disabled = currentSection >= total - 1;

    eyebrowEl.textContent = topic.title;
    sectionTitleEl.textContent = section?.title ?? topic.title;
    document.title = `${section?.title ?? topic.title} — ${site.title}`;

    setActiveNav();
    updateHash();

    // Rebuild TOC for current topic (all sections)
    initToc(topic.sections);
  }

  function showTopic(slug, sectionId) {
    if (!topics[slug]) slug = defaultTopic;
    currentTopic = slug;

    let idx = 0;
    if (sectionId) {
      const found = topics[slug].sections.findIndex((s) => s.id === sectionId);
      if (found >= 0) idx = found;
    }
    currentSection = idx;
    closeMobileNav();
    renderContent();
  }

  function showSection(index) {
    const topic = topics[currentTopic];
    if (!topic || index < 0 || index >= topic.sections.length) return;
    currentSection = index;
    renderContent();
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  /* ── Copy code button (event delegation) ── */
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".copy-code-btn");
    if (!btn) return;
    const toolbar = btn.closest(".code-toolbar");
    if (!toolbar) return;
    const code = toolbar.querySelector("code");
    const text = code?.innerText ?? "";
    const toast = toolbar.querySelector(".copy-toast");

    function show(msg, ok) {
      if (!toast) return;
      toast.textContent = msg;
      toast.classList.add("show");
      btn.classList.toggle("success", ok);
      setTimeout(() => {
        toast.classList.remove("show");
        btn.classList.remove("success");
      }, 1600);
    }

    // 1st: Clipboard API
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        show("복사됨", true);
        return;
      } catch { /* fall through */ }
    }
    // 2nd: file:// fallback (execCommand)
    try {
      const range = document.createRange();
      range.selectNode(code);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const ok = document.execCommand("copy");
      sel.removeAllRanges();
      show(ok ? "복사됨" : "Ctrl+C로 복사해 주세요", ok);
    } catch {
      show("Ctrl+C로 복사해 주세요", false);
    }
  });

  /* ── TOC (section-per-view model) ──
     Each TOC anchor stores the section index. Click navigates via showSection()
     instead of scrolling DOM headings (which don't exist for non-current sections).
  */

  function clearToc() {
    const panel = document.getElementById("toc-panel");
    if (panel) panel.innerHTML = "";
  }

  function initToc(sections) {
    clearToc();
    const panel = document.getElementById("toc-panel");
    if (!panel || !sections || sections.length === 0) return;

    const ul = document.createElement("ul");

    sections.forEach((sec, i) => {
      // Section h2
      const li = document.createElement("li");
      li.className = "depth-2";
      const a = document.createElement("a");
      a.href = "#" + sec.id;
      a.dataset.sectionIdx = i;
      a.dataset.tocTarget = sec.id;
      a.textContent = sec.title;
      a.classList.toggle("active", i === currentSection);
      li.appendChild(a);
      ul.appendChild(li);

      // h3/h4 within section (only shown when this section is active)
      if (sec.headings && i === currentSection) {
        sec.headings.forEach((h) => {
          if (h.depth < 3) return; // skip the virtual h2
          const subLi = document.createElement("li");
          subLi.className = "depth-" + h.depth;
          const subA = document.createElement("a");
          subA.href = "#" + h.id;
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

  const tocToggleBtn = document.getElementById("toc-toggle");
  const tocPanel = document.getElementById("toc-panel");
  const tocBackdrop = document.getElementById("toc-backdrop");

  function closeToc() {
    tocPanel?.classList.remove("open");
    tocToggleBtn?.setAttribute("aria-expanded", "false");
    tocBackdrop?.setAttribute("hidden", "");
  }

  tocToggleBtn?.addEventListener("click", () => {
    const expanded = tocToggleBtn.getAttribute("aria-expanded") === "true";
    tocToggleBtn.setAttribute("aria-expanded", String(!expanded));
    tocPanel?.classList.toggle("open", !expanded);
    if (expanded) {
      tocBackdrop?.setAttribute("hidden", "");
    } else {
      tocBackdrop?.removeAttribute("hidden");
    }
  });

  tocBackdrop?.addEventListener("click", closeToc);

  // TOC click handler: registered once in main flow (not inside initToc)
  tocPanel?.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-section-idx]");
    if (!a) return;
    e.preventDefault();
    const idx = parseInt(a.dataset.sectionIdx, 10);
    showSection(idx);
    // Scroll to sub-heading after section renders
    const headingId = a.dataset.headingId;
    if (headingId) {
      requestAnimationFrame(() => {
        const el = document.getElementById(headingId);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  });

  topicBtns.forEach((btn) => {
    btn.addEventListener("click", () => showTopic(btn.dataset.topic));
  });

  themeToggleBtn?.addEventListener("click", () => {
    setTheme(getTheme() === "dark" ? "light" : "dark");
    highlightCode();
  });

  setTheme(getTheme());

  navToggle?.addEventListener("click", () => {
    if (navPanel?.classList.contains("open")) closeMobileNav();
    else openMobileNav();
  });

  navBackdrop?.addEventListener("click", closeMobileNav);

  prevBtn.addEventListener("click", () => showSection(currentSection - 1));
  nextBtn.addEventListener("click", () => showSection(currentSection + 1));

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      showSection(currentSection - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      showSection(currentSection + 1);
    } else if (e.key === "Escape") {
      closeMobileNav();
      closeToc();
    }
  });

  window.addEventListener("hashchange", () => {
    const { topic, sectionId } = parseHash();
    showTopic(topic, sectionId);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 800) closeMobileNav();
    if (window.innerWidth >= 1200) closeToc();
  });

  const initial = parseHash();
  showTopic(initial.topic, initial.sectionId);

  /* ── Search modal ── */
  const searchTrigger = document.getElementById("search-trigger");
  const searchModal = document.getElementById("search-modal");
  const searchBackdrop = document.getElementById("search-backdrop");
  const searchInput = document.getElementById("search-input");
  const searchResults = document.getElementById("search-results");

  let searchActiveIdx = -1;
  let searchLastQuery = "";
  let searchDebounceTimer = null;
  let _cachedRecords = null;

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
    setTimeout(() => searchInput?.focus(), 50);
  }

  function closeSearchModal() {
    if (!searchModal || !searchBackdrop) return;
    searchModal.setAttribute("hidden", "");
    searchBackdrop.setAttribute("hidden", "");
    document.body.style.overflow = "";
    searchDebounceTimer && clearTimeout(searchDebounceTimer);
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
    // ASCII identifiers/words
    var ascii = str.match(/[A-Za-z][A-Za-z0-9_]*/g);
    if (ascii) for (var i = 0; i < ascii.length; i++) set[ascii[i].toLowerCase()] = true;
    // Korean words via Intl.Segmenter (fallback: Hanguls split)
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
    const tokens = tokenize(query).map(function (t) { return t.toLowerCase(); }).filter(Boolean);
    if (!tokens.length) return [];
    return records
      .map(function (r) {
        const sectionLower = r.sectionTitle.toLowerCase();
        const bodyLower = r.body.toLowerCase();
        var score = 0;
        for (var i = 0; i < tokens.length; i++) {
          var t = tokens[i];
          if (sectionLower.includes(t)) score += 10;
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

  function getRecords() {
    if (_cachedRecords) return _cachedRecords;
    var el = document.getElementById("search-index");
    _cachedRecords = el ? (JSON.parse(el.textContent).records || []) : [];
    return _cachedRecords;
  }

  function renderEmpty(msg) {
    searchResults.innerHTML = "<li class=\"search-empty\">" + escapeHtml(msg) + "</li>";
    searchActiveIdx = -1;
  }

  function setActive(i) {
    const items = searchResults.querySelectorAll(".search-result");
    if (!items.length) return;
    searchActiveIdx = ((i % items.length) + items.length) % items.length;
    items.forEach((el, j) => {
      el.classList.toggle("active", j === searchActiveIdx);
      el.setAttribute("aria-selected", String(j === searchActiveIdx));
      if (j === searchActiveIdx) el.scrollIntoView({ block: "nearest" });
    });
  }

  function makeSnippet(body, query) {
    const lower = body.toLowerCase();
    const idx = lower.indexOf(query.toLowerCase());
    if (idx === -1) return null;
    const start = Math.max(0, idx - 60);
    const end = Math.min(body.length, idx + query.length + 60);
    let s = body.slice(start, end);
    if (start > 0) s = "\u2026" + s;
    if (end < body.length) s = s + "\u2026";
    return highlightMatch(s, query);
  }

  function highlightMatch(text, query) {
    const escaped = escapeHtml(text);
    const re = new RegExp("(" + query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
    return escaped.replace(re, "<mark>$1</mark>");
  }

  function renderSearchResults(results, query) {
    searchResults.innerHTML = results
      .map(function (r, i) {
        const chain = [];
        if (r.topicGroup) chain.push(r.topicGroup);
        chain.push(r.topicTitle);
        chain.push(r.sectionTitle);
        const breadcrumb = chain.filter(Boolean).join(" \u203A ");
        const snippet = makeSnippet(r.body, query);
        const snippetHtml = snippet
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
    var records = getRecords();
    var results = searchRecords(query, records);
    if (!results.length) {
      renderEmpty("결과 없음");
      return;
    }
    renderSearchResults(results, query);
  }

  function jumpToMatch(slug, sectionId, query) {
    closeSearchModal();
    showTopic(slug, sectionId);
    requestAnimationFrame(function () {
      var root = document.getElementById("content-viewport");
      if (!root || !query) return;
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          var p = n.parentElement;
          while (p && p !== root) {
            if (p.tagName === "PRE" || p.tagName === "CODE")
              return NodeFilter.FILTER_REJECT;
            p = p.parentElement;
          }
          return n.nodeValue.toLowerCase().includes(query.toLowerCase())
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      });
      var hits = [];
      var n;
      while ((n = walker.nextNode())) {
        var text = n.nodeValue;
        var idx = text.toLowerCase().indexOf(query.toLowerCase());
        if (idx === -1) continue;
        var before = text.slice(0, idx);
        var matchText = text.slice(idx, idx + query.length);
        var after = text.slice(idx + query.length);
        var parent = n.parentNode;
        var beforeNode = document.createTextNode(before);
        var matchSpan = document.createElement("mark");
        matchSpan.className = "search-hit-mark";
        matchSpan.textContent = matchText;
        var afterNode = document.createTextNode(after);
        parent.insertBefore(beforeNode, n);
        parent.insertBefore(matchSpan, n);
        parent.replaceChild(afterNode, n);
        hits.push({ node: matchSpan, text: matchText });
      }
      if (hits.length) {
        var first = hits[0].node;
        first.scrollIntoView({ block: "center", behavior: "smooth" });
        // Fade out after 200ms, remove after 1500ms
        setTimeout(function () {
          hits.forEach(function (h) {
            h.node.classList.add("fading");
          });
        }, 200);
        setTimeout(function () {
          hits.forEach(function (h) {
            // unwrap: replace mark with text node
            var p = h.node.parentNode;
            if (p) {
              var txt = document.createTextNode(h.text);
              p.replaceChild(txt, h.node);
            }
          });
        }, 1500);
      }
    });
  }

  // Click on search trigger
  searchTrigger?.addEventListener("click", openSearchModal);

  // Backdrop click -> close
  searchBackdrop?.addEventListener("click", closeSearchModal);

  // Input handler with debounce
  searchInput?.addEventListener("input", function () {
    searchDebounceTimer && clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(runSearch, 100);
  });

  // Keyboard inside modal
  searchModal?.addEventListener("keydown", function (e) {
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
        jumpToMatch(target.dataset.slug, target.dataset.section, searchLastQuery);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearchModal();
    }
  });

  // Click on a result item
  searchResults?.addEventListener("click", function (e) {
    var item = e.target.closest(".search-result");
    if (!item) return;
    jumpToMatch(item.dataset.slug, item.dataset.section, searchLastQuery);
  });

  // Global keyboard shortcuts
  document.addEventListener("keydown", function (e) {
    // Cmd/Ctrl+K
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openSearchModal();
      return;
    }
    // "/" outside input fields
    if (
      e.key === "/" &&
      !/^(input|textarea|select)$/i.test(e.target.tagName) &&
      !searchModalIsOpen()
    ) {
      e.preventDefault();
      openSearchModal();
    }
  });
})();
