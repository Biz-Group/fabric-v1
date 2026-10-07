// Injected before page scripts: swaps real people's names for stand-ins and keeps
// them swapped as React re-renders. Also replaces the signed-in user's avatar.
(() => {
  // [real, stand-in] pairs come from mask-names.json (gitignored), injected by capture.mjs.
  const PAIRS = window.__MASK_PAIRS || [];
  const rules = PAIRS.map(([from, to]) => [
    new RegExp(
      (/^\w/.test(from) ? "\\b" : "") + from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + (/\w$/.test(from) ? "\\b" : ""),
      "g",
    ),
    to,
  ]);
  const swap = (s) => {
    let out = s;
    for (const [re, to] of rules) out = out.replace(re, to);
    return out.replace(/ {2,}/g, " ");
  };
  const AVATAR =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#356DFF"/><text x="32" y="41" font-family="Inter,Arial" font-size="24" font-weight="600" fill="#fff" text-anchor="middle">AL</text></svg>',
    );

  const fixNode = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const v = n.nodeValue;
      if (v && /[A-Z(]/.test(v)) {
        const next = swap(v);
        if (next !== v) n.nodeValue = next;
      }
    }
    if (root.querySelectorAll) {
      for (const el of root.querySelectorAll("[aria-label],[title]")) {
        for (const attr of ["aria-label", "title"]) {
          const v = el.getAttribute(attr);
          if (v && swap(v) !== v) el.setAttribute(attr, swap(v));
        }
      }
      for (const img of root.querySelectorAll(".cl-userButtonTrigger img, .cl-userButtonAvatarImage, .cl-avatarImage")) {
        if (img.src !== AVATAR) img.src = AVATAR;
        img.removeAttribute("srcset");
      }
    }
  };

  const start = () => {
    fixNode(document.body);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "characterData") fixNode(m.target.parentNode || document.body);
        for (const n of m.addedNodes) fixNode(n.nodeType === 1 ? n : n.parentNode || document.body);
        if (m.type === "attributes" && m.target.nodeType === 1) fixNode(m.target);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["src"] });
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
