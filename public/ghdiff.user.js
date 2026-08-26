// ==UserScript==
// @name         ghdiff
// @namespace    https://ghdiff.com/
// @version      1.0.0
// @description  Adds a ghdiff button to the tab bar of every GitHub pull request, beside Files changed.
// @author       GalvinGao
// @homepageURL  https://github.com/GalvinGao/ghdiff
// @supportURL   https://github.com/GalvinGao/ghdiff/issues
// @downloadURL  https://ghdiff.com/ghdiff.user.js
// @updateURL    https://ghdiff.com/ghdiff.user.js
// @match        https://github.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

// The match is every page on github.com and not the pull request paths alone.
// GitHub moves between its own pages without reloading the document, and a
// userscript manager runs a script once per document, so a script that only
// matched `/*/*/pull/*` would never start for a reviewer who arrived from the
// repository's own list.

(() => {
  'use strict';

  const APP_ORIGIN = 'https://ghdiff.com';
  const BUTTON_ID = 'ghdiff-open-button';
  const STYLE_ID = 'ghdiff-open-style';

  const PULL_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/;

  // github.com writes the file part of a diff anchor as the SHA-256 of the
  // path, and ghdiff reads that form, so a reviewer who followed a link to one
  // file keeps that file. Every other fragment github.com writes — a comment,
  // a commit, the skip link — names something ghdiff has no address for, and
  // carrying one over would put a fragment in the bar that resolves to nothing.
  const GITHUB_DIFF_HASH = /^#diff-[0-9a-f]{64}(?:[LR]\d+(?:-[LR]\d+)?)?$/;

  // The button is not styled with `btn btn-sm`. Those classes are Primer's and
  // the React pull request header has already stopped using most of the rest of
  // that stylesheet. The custom properties below are Primer's design tokens,
  // which both headers still set on the document, so the button follows the
  // reviewer's own light and dark scheme; the fallbacks are Primer's light
  // values, for the day a token is renamed.
  const STYLE = `
#${BUTTON_ID} {
  display: inline-flex;
  align-items: center;
  align-self: center;
  flex: 0 0 auto;
  margin-left: 8px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--borderColor-default, #d1d9e0);
  border-radius: var(--borderRadius-medium, 6px);
  background: var(--button-default-bgColor-rest, #f6f8fa);
  color: var(--fgColor-default, #1f2328);
  font-family: var(--fontStack-sansSerif, -apple-system, system-ui, sans-serif);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  text-decoration: none;
  white-space: nowrap;
}
#${BUTTON_ID}:hover {
  background: var(--button-default-bgColor-hover, #eff2f5);
  text-decoration: none;
}
#${BUTTON_ID}:focus-visible {
  outline: 2px solid var(--focus-outlineColor, #0969da);
  outline-offset: -1px;
}
`;

  /** The owner, the repository and the number, or null on any other page. */
  function pullTarget() {
    const match = PULL_PATH.exec(location.pathname);
    if (match == null) return null;
    return { owner: match[1], repo: match[2], number: match[3] };
  }

  function ghdiffHref(target) {
    const path = `/${target.owner}/${target.repo}/pull/${target.number}`;
    const hash = GITHUB_DIFF_HASH.test(location.hash) ? location.hash : '';
    return `${APP_ORIGIN}${path}${hash}`;
  }

  // The row of tabs, in the two headers GitHub serves today. The React header
  // names its own classes with a hash per build, so `aria-label` is the one
  // thing on it that a script can hold to.
  const TAB_LISTS = [
    'nav[aria-label="Pull request navigation"] > *',
    '.tabnav-tabs',
  ];

  function findTabList() {
    for (const selector of TAB_LISTS) {
      const found = document.querySelector(selector);
      if (found != null) return found;
    }
    return findTabListByFilesTab();
  }

  // Neither selector above is a contract, and GitHub has already replaced this
  // header once. What the tab bar is, rather than what it is called, is the row
  // that holds the link to this pull request's own Files changed page — so find
  // that link and take the row it sits in. A link with a fragment is not it:
  // the page's skip link resolves to the same path.
  function findTabListByFilesTab() {
    const target = pullTarget();
    if (target == null) return null;
    const files = `/${target.owner}/${target.repo}/pull/${target.number}/files`;
    for (const link of document.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href');
      if (href == null) continue;
      const url = new URL(href, location.href);
      if (url.pathname !== files) continue;
      if (url.hash !== '' || url.search !== '') continue;
      if (link.offsetParent == null) continue;
      const row = link.parentElement;
      if (row != null && row.children.length > 1) return row;
    }
    return null;
  }

  function buildButton() {
    const button = document.createElement('a');
    button.id = BUTTON_ID;
    button.title = 'Open this pull request in ghdiff';
    button.textContent = 'ghdiff';
    return button;
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID) != null) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    (document.head ?? document.documentElement).append(style);
  }

  function sync() {
    const target = pullTarget();
    const existing = document.getElementById(BUTTON_ID);
    if (target == null) {
      existing?.remove();
      return;
    }
    const list = findTabList();
    if (list == null) {
      existing?.remove();
      return;
    }
    installStyle();
    const button = existing ?? buildButton();
    const href = ghdiffHref(target);
    if (button.getAttribute('href') !== href) button.setAttribute('href', href);
    // React owns this row and re-renders it, which drops anything it did not
    // put there. Appending is what brings the button back. Appending only when
    // it is not already the last child is what keeps this from answering its
    // own observer for ever.
    if (button.parentElement !== list || button.nextElementSibling != null) {
      list.append(button);
    }
  }

  let pending = false;

  // A pull request with 300 files reports thousands of mutations while it
  // renders. Each one asks for a sync, and the flag below turns that into one
  // sync every 50 ms.
  //
  // A timer and not `requestAnimationFrame`: a reviewer opens a pull request in
  // a background tab, the browser paints no frames there, and a script that
  // waited for one would leave the button off the page until the tab came
  // forward.
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      sync();
    }, 50);
  }

  sync();

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  // A move between files inside one page changes the address and nothing else,
  // so neither of these has a mutation to report.
  window.addEventListener('hashchange', schedule);
  window.addEventListener('popstate', schedule);
})();
