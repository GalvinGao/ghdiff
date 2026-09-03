// ==UserScript==
// @name         ghdiff
// @namespace    https://ghdiff.com/
// @version      1.2.0
// @description  Adds a ghdiff button to every GitHub pull request, beside Files changed, and to every commit, beside Browse files.
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
  const COMMIT_PATH = /^\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]{7,40})(?:\/|$)/i;

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
  //
  // Everything that is the same wherever the button lands is stated once, and
  // `data-ghdiff-place` carries the rest. The two rows it goes in are not the
  // same row: the pull request's tab bar has no gap of its own and holds 28px
  // controls at 12px, and the commit header's action row is a flex row with an
  // 8px gap holding a 32px Browse files at 14px. A button that took the tab
  // bar's figures into the commit header would sit short beside it, and one
  // that kept the tab bar's own margin there would sit 16px off.
  const STYLE = `
#${BUTTON_ID} {
  display: inline-flex;
  align-items: center;
  align-self: center;
  flex: 0 0 auto;
  border: 1px solid var(--borderColor-default, #d1d9e0);
  border-radius: var(--borderRadius-medium, 6px);
  background: var(--button-default-bgColor-rest, #f6f8fa);
  color: var(--fgColor-default, #1f2328);
  font-family: var(--fontStack-sansSerif, -apple-system, system-ui, sans-serif);
  line-height: 1;
  text-decoration: none;
  white-space: nowrap;
}
#${BUTTON_ID}[data-ghdiff-place="tabs"] {
  margin-left: 8px;
  height: 28px;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 600;
}
#${BUTTON_ID}[data-ghdiff-place="actions"] {
  height: 32px;
  padding: 0 12px;
  font-size: 14px;
  font-weight: 500;
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

  /**
   * The diff on screen, or null on any other page. A pull request and a commit
   * are the two github.com pages that are one diff and that ghdiff has an
   * address for; a compare range is the third, and its header carries no
   * control of its own to sit beside.
   */
  function currentTarget() {
    const pull = PULL_PATH.exec(location.pathname);
    if (pull != null) {
      const selected =
        /\/pull\/\d+\/(?:commits|changes)\/([0-9a-f]{40})\/?$/i.exec(
          location.pathname
        );
      return {
        kind: 'pull',
        owner: pull[1],
        repo: pull[2],
        number: pull[3],
        commitSha: selected?.[1].toLowerCase(),
      };
    }
    const commit = COMMIT_PATH.exec(location.pathname);
    if (commit != null) {
      return {
        kind: 'commit',
        owner: commit[1],
        repo: commit[2],
        sha: commit[3],
      };
    }
    return null;
  }

  /** github.com's own path for this target, which is ghdiff's path as well. */
  function targetPath(target) {
    return target.kind === 'pull'
      ? `/${target.owner}/${target.repo}/pull/${target.number}${target.commitSha == null ? '' : `/commits/${target.commitSha}`}`
      : `/${target.owner}/${target.repo}/commit/${target.sha}`;
  }

  function ghdiffHref(target) {
    const hash = GITHUB_DIFF_HASH.test(location.hash) ? location.hash : '';
    return `${APP_ORIGIN}${targetPath(target)}${hash}`;
  }

  function buttonTitle(target) {
    return target.kind === 'pull'
      ? 'Open this pull request in ghdiff'
      : 'Open this commit in ghdiff';
  }

  // The row of tabs, in the two headers GitHub serves today. The React header
  // names its own classes with a hash per build, so `aria-label` is the one
  // thing on it that a script can hold to.
  const TAB_LISTS = [
    'nav[aria-label="Pull request navigation"] > *',
    '.tabnav-tabs',
  ];

  /**
   * Where the button goes for this target: the tab bar on a pull request, the
   * action row on a commit. Both are found by what they hold rather than by
   * what they are called — see the two functions below.
   */
  function findHost(target) {
    if (target.kind === 'commit') return findRowByLinkTo(treePath(target));
    for (const selector of TAB_LISTS) {
      const found = document.querySelector(selector);
      if (found != null) return found;
    }
    return findRowByLinkTo(
      `/${target.owner}/${target.repo}/pull/${target.number}/files`
    );
  }

  /** Browse files, which is this commit's own tree page. */
  function treePath(target) {
    return `/${target.owner}/${target.repo}/tree/${target.sha}`;
  }

  // No selector GitHub gives is a contract, and it has already replaced the
  // pull request header once. So neither row is looked up by name. What each one
  // *is* is the row that holds the link to one page — Files changed for a pull
  // request, Browse files for a commit — so find that link and take the row it
  // sits in.
  //
  // A link with a fragment or a query is not it: the page's own skip link
  // resolves to the same path. A link that is not on screen is not it either,
  // and the commit header holds two of them — a wide one with the words and a
  // narrow icon, one of which is always hidden. They share the one row, so
  // whichever is on screen answers.
  function findRowByLinkTo(path) {
    for (const link of document.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href');
      if (href == null) continue;
      const url = new URL(href, location.href);
      if (url.pathname !== path) continue;
      if (url.hash !== '' || url.search !== '') continue;
      if (link.offsetParent == null) continue;
      const row = link.parentElement;
      if (row != null && row.children.length > 1) return row;
    }
    return null;
  }

  function placeFor(target) {
    return target.kind === 'pull' ? 'tabs' : 'actions';
  }

  function buildButton() {
    const button = document.createElement('a');
    button.id = BUTTON_ID;
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
    const target = currentTarget();
    const existing = document.getElementById(BUTTON_ID);
    if (target == null) {
      existing?.remove();
      return;
    }
    const host = findHost(target);
    if (host == null) {
      existing?.remove();
      return;
    }
    installStyle();
    const button = existing ?? buildButton();
    // A move from a pull request to a commit reuses this button, so everything
    // that differs between the two is written on every sync and not once at
    // build time.
    const href = ghdiffHref(target);
    if (button.getAttribute('href') !== href) button.setAttribute('href', href);
    const place = placeFor(target);
    if (button.dataset.ghdiffPlace !== place)
      button.dataset.ghdiffPlace = place;
    const title = buttonTitle(target);
    if (button.title !== title) button.title = title;
    // React owns these rows and re-renders them, which drops anything it did
    // not put there. Appending is what brings the button back. Appending only
    // when it is not already the last child is what keeps this from answering
    // its own observer for ever.
    if (button.parentElement !== host || button.nextElementSibling != null) {
      host.append(button);
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
