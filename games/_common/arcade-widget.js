// Claude Arcade — shared per-page widget: a "Rules" button (opens the game's
// how-to-play any time, not just on the start screen) and an "Ideas" button
// (a structured suggestion form + the accepted-idea roadmap read from GitLab).
//
// Classic script (no modules) so it loads from file:// too. Everything lives in
// a Shadow DOM so it cannot collide with — or be broken by — any game's CSS.
// It NEVER touches the network on load: the roadmap is fetched lazily when the
// player opens it, and the form only POSTs on submit. That keeps the games'
// "zero console errors on load" browser tests green.
//
// Usage (per game, after arcade-config.js + this file are included):
//   ArcadeWidget.init({
//     slug: "gloamkeep",
//     title: "Gloamkeep",
//     rulesSelector: "#overlay-start .controls",  // cloned into the rules modal
//     // or: rulesHTML: "<p>...</p>"
//     onOpen()  {},   // optional: pause the game / release pointer lock
//     onClose() {},   // optional: resume
//   });
(function () {
  "use strict";

  var CFG = window.ARCADE_CONFIG || {};
  var State = { inited: false, host: null, root: null, opts: null, roadmapLoaded: false };

  function el(root, sel) { return root.querySelector(sel); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: ui-monospace, "Cascadia Code", Menlo, Consolas, monospace; }
  .cluster {
    position: fixed; right: 10px; bottom: 10px; z-index: 2147483000;
    display: flex; gap: 6px;
  }
  .tab {
    appearance: none; cursor: pointer; border: 1px solid #2c333d;
    background: rgba(18,21,26,0.86); color: #cdd3da;
    border-radius: 7px; padding: 7px 11px; font-size: 12px; letter-spacing: 0.04em;
    backdrop-filter: blur(3px); line-height: 1;
  }
  .tab:hover { border-color: #7ee787; color: #e8eaed; }
  .tab .ic { margin-right: 5px; }
  .scrim {
    position: fixed; inset: 0; z-index: 2147483001; display: none;
    align-items: center; justify-content: center;
    background: rgba(4,6,9,0.62); padding: 16px;
  }
  .scrim.open { display: flex; }
  .modal {
    background: #14171d; color: #e8eaed; border: 1px solid #2c333d;
    border-radius: 10px; width: min(560px, 100%); max-height: min(86vh, 720px);
    overflow: auto; box-shadow: 0 18px 60px rgba(0,0,0,0.6);
  }
  .modal header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 18px; border-bottom: 1px solid #262b33; position: sticky; top: 0;
    background: #14171d;
  }
  .modal header h2 { font-size: 15px; letter-spacing: 0.06em; margin: 0; color: #e8eaed; font-weight: 700; }
  .x { appearance: none; cursor: pointer; background: none; border: none; color: #8b93a1; font-size: 20px; line-height: 1; padding: 2px 6px; }
  .x:hover { color: #e8eaed; }
  .body { padding: 16px 18px; font-size: 13px; line-height: 1.6; color: #cdd3da; }
  .body b, .body kbd, .rules b, .rules kbd { color: #ffd9a0; }
  .rules :is(div, p, li) { margin: 0 0 6px; }
  .rules ul { padding-left: 18px; }
  .tabs { display: flex; gap: 4px; padding: 12px 18px 0; }
  .tabbtn { appearance: none; cursor: pointer; border: 1px solid transparent; background: none;
    color: #8b93a1; padding: 6px 10px; border-radius: 6px 6px 0 0; font-size: 12px; letter-spacing: 0.05em; }
  .tabbtn.on { color: #e8eaed; border-color: #2c333d; border-bottom-color: #14171d; }
  .pane { display: none; } .pane.on { display: block; }
  label.f { display: block; margin: 0 0 11px; font-size: 12px; color: #8b93a1; letter-spacing: 0.04em; }
  label.f span { display: block; margin-bottom: 4px; }
  input, select, textarea {
    width: 100%; background: #0e1116; color: #e8eaed; border: 1px solid #2c333d;
    border-radius: 6px; padding: 8px 10px; font-size: 13px; font-family: inherit;
  }
  input:focus, select:focus, textarea:focus { outline: none; border-color: #7ee787; }
  textarea { resize: vertical; min-height: 84px; }
  .hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
  .actions { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
  .submit { appearance: none; cursor: pointer; border: 1px solid #7ee787;
    background: linear-gradient(180deg, #1c3a24, #14261a); color: #e8eaed;
    border-radius: 6px; padding: 9px 18px; font-size: 13px; letter-spacing: 0.05em; }
  .submit:hover { filter: brightness(1.2); }
  .submit:disabled { opacity: 0.5; cursor: default; filter: none; }
  .status { font-size: 12px; color: #8b93a1; }
  .status.ok { color: #7ee787; } .status.err { color: #e0736b; }
  .road { list-style: none; margin: 0; padding: 0; }
  .road li { padding: 8px 0; border-bottom: 1px solid #20252d; }
  .road a { color: #cdd3da; text-decoration: none; }
  .road a:hover { color: #7ee787; }
  .road .lbl { display: inline-block; font-size: 10px; color: #8b93a1; border: 1px solid #2c333d;
    border-radius: 4px; padding: 1px 5px; margin-right: 6px; text-transform: uppercase; letter-spacing: 0.06em; }
  .muted { color: #8b93a1; font-size: 12px; }
  a.more { color: #7ee787; text-decoration: none; font-size: 12px; }
  @media (max-width: 560px) {
    .cluster { right: 8px; bottom: 8px; }
    .tab .lbl-txt { display: none; } .tab .ic { margin-right: 0; }
  }`;

  function template(opts) {
    var gameOptions = "";
    var games = window.GAMES;
    if (games && games.length) {
      for (var i = 0; i < games.length; i++) {
        var sel = games[i].slug === opts.slug ? " selected" : "";
        gameOptions += '<option value="' + esc(games[i].slug) + '"' + sel + ">" + esc(games[i].title) + "</option>";
      }
      gameOptions += '<option value="general">Arcade (general)</option>';
    } else {
      gameOptions =
        '<option value="' + esc(opts.slug) + '" selected>' + esc(opts.title || opts.slug) + "</option>" +
        '<option value="general">Arcade (general)</option>';
    }

    return (
      "<style>" + CSS + "</style>" +
      '<div class="cluster">' +
        (opts.hideRules ? "" :
          '<button class="tab" data-open="rules"><span class="ic">?</span><span class="lbl-txt">Rules</span></button>') +
        '<button class="tab" data-open="ideas"><span class="ic">&#9733;</span><span class="lbl-txt">Ideas</span></button>' +
      "</div>" +

      '<div class="scrim" data-modal="rules"><div class="modal">' +
        '<header><h2>How to play &mdash; ' + esc(opts.title || opts.slug) + '</h2><button class="x" data-close>&times;</button></header>' +
        '<div class="body rules" data-rules></div>' +
      "</div></div>" +

      '<div class="scrim" data-modal="ideas"><div class="modal">' +
        '<header><h2>Player ideas</h2><button class="x" data-close>&times;</button></header>' +
        '<div class="tabs">' +
          '<button class="tabbtn on" data-pane="suggest">Suggest</button>' +
          '<button class="tabbtn" data-pane="roadmap">Roadmap</button>' +
        "</div>" +
        '<div class="body">' +
          '<div class="pane on" data-pane="suggest">' +
            '<label class="f"><span>What kind?</span><select data-f="kind">' +
              '<option value="idea">Idea / feature</option>' +
              '<option value="bug">Bug</option>' +
              '<option value="balance">Balance / tuning</option>' +
              '<option value="other">Other</option>' +
            "</select></label>" +
            '<label class="f"><span>Which game?</span><select data-f="game">' + gameOptions + "</select></label>" +
            '<label class="f"><span>Summary</span><input data-f="summary" maxlength="120" placeholder="one line"></label>' +
            '<label class="f"><span>Details</span><textarea data-f="details" maxlength="4000" placeholder="what would you change, and why?"></textarea></label>' +
            '<label class="f"><span>Your handle (optional)</span><input data-f="handle" maxlength="80" placeholder="so you get credit"></label>' +
            '<label class="hp"><span>Leave this empty</span><input data-f="website" tabindex="-1" autocomplete="off"></label>' +
            '<div class="actions"><button class="submit" data-submit>Send it in</button><span class="status" data-status></span></div>' +
          "</div>" +
          '<div class="pane" data-pane="roadmap">' +
            '<div data-roadmap><p class="muted">Loading accepted ideas&hellip;</p></div>' +
          "</div>" +
        "</div>" +
      "</div></div>"
    );
  }

  function open(kind) {
    var root = State.root;
    var scrim = root.querySelector('.scrim[data-modal="' + kind + '"]');
    if (!scrim) return;
    if (kind === "rules") fillRules();
    scrim.classList.add("open");
    if (State.opts.onOpen) { try { State.opts.onOpen(); } catch (e) {} }
    try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {}
  }

  function closeAll() {
    var scrims = State.root.querySelectorAll(".scrim");
    var wasOpen = false;
    for (var i = 0; i < scrims.length; i++) {
      if (scrims[i].classList.contains("open")) wasOpen = true;
      scrims[i].classList.remove("open");
    }
    if (wasOpen && State.opts.onClose) { try { State.opts.onClose(); } catch (e) {} }
  }

  function fillRules() {
    var target = el(State.root, "[data-rules]");
    if (target.getAttribute("data-filled")) return;
    var html = State.opts.rulesHTML;
    if (!html && State.opts.rulesSelector) {
      var src = document.querySelector(State.opts.rulesSelector);
      if (src) html = src.innerHTML;
    }
    target.innerHTML = html || '<p class="muted">See the start screen for the controls.</p>';
    target.setAttribute("data-filled", "1");
  }

  function selectPane(name) {
    var root = State.root;
    var btns = root.querySelectorAll(".tabbtn");
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle("on", btns[i].getAttribute("data-pane") === name);
    var panes = root.querySelectorAll(".pane");
    for (var j = 0; j < panes.length; j++) panes[j].classList.toggle("on", panes[j].getAttribute("data-pane") === name);
    if (name === "roadmap") loadRoadmap();
  }

  function loadRoadmap() {
    if (State.roadmapLoaded) return;
    State.roadmapLoaded = true;
    var box = el(State.root, "[data-roadmap]");
    var host = CFG.gitlabHost || "https://gitlab.com";
    var project = CFG.gitlabProject;
    if (!project) { box.innerHTML = '<p class="muted">Roadmap isn\'t configured yet.</p>'; return; }
    var labels = [CFG.suggestionLabel || "suggestion", CFG.roadmapLabel || "accepted"];
    if (State.opts.slug && State.opts.slug !== "arcade") labels.push("game::" + State.opts.slug);
    var url = host + "/api/v4/projects/" + encodeURIComponent(project) +
      "/issues?state=opened&per_page=30&labels=" + encodeURIComponent(labels.join(","));
    var projPath = host + "/" + project + "/-/issues?label_name[]=" + encodeURIComponent(CFG.roadmapLabel || "accepted");

    fetch(url, { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (issues) {
        if (!issues.length) {
          box.innerHTML = '<p class="muted">No accepted ideas yet — be the first to suggest one.</p>' +
            '<p><a class="more" href="' + esc(projPath) + '" target="_blank" rel="noopener">Browse all on GitLab &rarr;</a></p>';
          return;
        }
        var out = '<ul class="road">';
        for (var i = 0; i < issues.length; i++) {
          var it = issues[i];
          var type = "";
          for (var k = 0; k < (it.labels || []).length; k++) {
            if (it.labels[k].indexOf("type::") === 0) type = it.labels[k].slice(6);
          }
          out += '<li><a href="' + esc(it.web_url) + '" target="_blank" rel="noopener">' +
            (type ? '<span class="lbl">' + esc(type) + "</span>" : "") + esc(it.title) + "</a></li>";
        }
        out += "</ul>";
        out += '<p style="margin-top:12px"><a class="more" href="' + esc(projPath) + '" target="_blank" rel="noopener">See the full board on GitLab &rarr;</a></p>';
        box.innerHTML = out;
      })
      .catch(function () {
        box.innerHTML = '<p class="muted">Couldn\'t load the roadmap right now.</p>' +
          '<p><a class="more" href="' + esc(projPath) + '" target="_blank" rel="noopener">Browse ideas on GitLab &rarr;</a></p>';
      });
  }

  function submit() {
    var root = State.root;
    var status = el(root, "[data-status]");
    var btn = el(root, "[data-submit]");
    function set(msg, cls) { status.textContent = msg; status.className = "status" + (cls ? " " + cls : ""); }

    var payload = {
      kind: el(root, '[data-f="kind"]').value,
      game: el(root, '[data-f="game"]').value,
      summary: el(root, '[data-f="summary"]').value.trim(),
      details: el(root, '[data-f="details"]').value.trim(),
      handle: el(root, '[data-f="handle"]').value.trim(),
      website: el(root, '[data-f="website"]').value,
    };
    if (payload.summary.length < 3 || payload.details.length < 3) {
      set("Add a summary and a little detail first.", "err");
      return;
    }
    var endpoint = CFG.feedbackEndpoint;
    if (!endpoint) {
      set("Thanks! Feedback intake isn't switched on yet — check back soon.", "err");
      return;
    }
    btn.disabled = true;
    set("Sending…");
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok, b: b }; }); })
      .then(function (res) {
        if (res.ok && res.b && res.b.ok !== false) {
          set("Sent — thank you! It'll show on the roadmap once reviewed.", "ok");
          el(root, '[data-f="summary"]').value = "";
          el(root, '[data-f="details"]').value = "";
        } else {
          set("Couldn't send that (" + ((res.b && res.b.error) || "error") + "). Try again later.", "err");
        }
        btn.disabled = false;
      })
      .catch(function () { set("Network error — try again later.", "err"); btn.disabled = false; });
  }

  function wire() {
    var root = State.root;
    root.addEventListener("click", function (e) {
      var t = e.target;
      var openBtn = t.closest("[data-open]");
      if (openBtn) { open(openBtn.getAttribute("data-open")); return; }
      if (t.closest("[data-close]")) { closeAll(); return; }
      if (t.classList && t.classList.contains("scrim")) { closeAll(); return; }
      var pane = t.closest("[data-pane]");
      if (pane && pane.classList.contains("tabbtn")) { selectPane(pane.getAttribute("data-pane")); return; }
      if (t.closest("[data-submit]")) { submit(); return; }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        var anyOpen = root.querySelector(".scrim.open");
        if (anyOpen) { e.stopPropagation(); closeAll(); }
      }
    }, true);
    // While a modal is open, keep keystrokes (typing in the form) from leaking
    // out of the shadow tree to the game's window/document key handlers.
    ["keydown", "keyup", "keypress"].forEach(function (type) {
      root.addEventListener(type, function (e) {
        if (root.querySelector(".scrim.open") && e.key !== "Escape") e.stopPropagation();
      });
    });
  }

  var ArcadeWidget = {
    init: function (opts) {
      if (State.inited) return;
      if (!opts || !opts.slug) return;
      State.inited = true;
      State.opts = opts;
      var host = document.createElement("div");
      host.id = "arcade-widget-host";
      host.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;z-index:2147483000;";
      (document.body || document.documentElement).appendChild(host);
      State.host = host;
      State.root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
      State.root.innerHTML = template(opts);
      wire();
    },
    open: open,
    close: closeAll,
  };

  window.ArcadeWidget = ArcadeWidget;
})();
