// Shared arcade configuration. Classic script (no modules) so it works when the
// pages are opened straight from the file tree (file://) as well as when served.
//
// Both the arcade shell (/index.html) and the per-game feedback/roadmap widget
// (games/_common/arcade-widget.js) read window.ARCADE_CONFIG.
window.ARCADE_CONFIG = {
  // GitLab project backing the public roadmap read (issues API, no token needed
  // for a public project). Path form "namespace/project".
  gitlabProject: "public-work4/claude-arcade",
  gitlabHost: "https://gitlab.com",

  // Serverless endpoint that receives a feedback submission and files a
  // triage issue on GitLab (see serverless/feedback-worker.js + its README).
  // Deploy the worker, then paste its public URL here. While this is empty the
  // "Suggest an idea" form still opens, but explains it isn't wired up yet —
  // nothing here ever calls the network on page load.
  feedbackEndpoint: "",

  // Labels the roadmap reads back. An idea shows on the roadmap once you (the
  // maintainer) relabel a triaged issue with `roadmapLabel`.
  suggestionLabel: "suggestion",
  roadmapLabel: "accepted",
};
