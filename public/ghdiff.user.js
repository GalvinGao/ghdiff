// ==UserScript==
// @name         ghdiff
// @namespace    https://ghdiff.com/
// @version      1.2.0
// @description  Adds a ghdiff button to the tab row of every GitHub pull request, and beside Browse files on every commit.
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

  // The button wears two skins, and `data-ghdiff-place` picks between them.
  // Both were read off the live page rather than guessed.
  //
  // In the pull request's tab row it is another one of github.com's own tabs —
  // the same `TabNavLink` the row draws for Files changed: transparent and
  // borderless in its unselected shape, `8px 12px` of padding at
  // `--text-body-size-medium` and weight 400, stretched to the row's height,
  // with a leading octicon in `--fgColor-muted` the way every tab in the row
  // carries one. The odd-looking `1.64em` line height is the override
  // github.com itself puts on those tabs, and the icon vanishes under
  // github.com's `sm` breakpoint the same way theirs does.
  //
  // Beside Browse files on a commit it is Primer React's own default `Button` —
  // the component github.com draws next to it there: a medium control at
  // `--control-medium-size`, weight 500, the 80 ms colour transition, the hover
  // and active backgrounds, and the focus ring.
  //
  // The custom properties are Primer's design tokens, which github.com sets on
  // the document element for both colour schemes, so the button follows the
  // reviewer's own scheme; the fallbacks are the ones Primer itself ships, for
  // the day a token is renamed.
  const STYLE = `
#${BUTTON_ID} {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  gap: var(--base-size-8, 8px);
  font-size: var(--text-body-size-medium, 14px);
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  appearance: none;
}
#${BUTTON_ID} .ghdiff-icon {
  flex: 0 0 auto;
  color: var(--fgColor-muted, #59636e);
}
#${BUTTON_ID}[data-ghdiff-place="tabs"] {
  align-self: stretch;
  padding: var(--base-size-8, 8px) var(--base-size-12, 12px);
  border: none;
  border-radius: 0;
  background-color: transparent;
  box-shadow: none;
  color: var(--fgColor-default, #1f2328);
  font-weight: var(--base-text-weight-normal, 400);
  line-height: 1.64em;
}
#${BUTTON_ID}[data-ghdiff-place="tabs"]:focus-visible {
  outline: var(--focus-outline, 2px solid var(--focus-outlineColor, #0969da));
  outline-offset: -6px;
}
@media (max-width: 575.98px) {
  #${BUTTON_ID}[data-ghdiff-place="tabs"] .ghdiff-icon {
    display: none;
  }
}
#${BUTTON_ID}[data-ghdiff-place="actions"] {
  align-self: center;
  height: var(--control-medium-size, 32px);
  padding: 0 var(--control-medium-paddingInline-normal, 12px);
  border: 1px solid var(--button-default-borderColor-rest, #d1d9e0);
  border-radius: var(--borderRadius-medium, 6px);
  background-color: var(--button-default-bgColor-rest, #f6f8fa);
  box-shadow: var(--button-default-shadow-resting, 0 1px 0 0 #1f23280a);
  color: var(--button-default-fgColor-rest, #25292e);
  font-weight: var(--base-text-weight-medium, 500);
  line-height: var(--text-body-lineHeight-medium, 1.5);
  user-select: none;
  transition: color 80ms cubic-bezier(0.65, 0, 0.35, 1),
    fill 80ms cubic-bezier(0.65, 0, 0.35, 1),
    background-color 80ms cubic-bezier(0.65, 0, 0.35, 1),
    border-color 80ms cubic-bezier(0.65, 0, 0.35, 1);
}
#${BUTTON_ID}[data-ghdiff-place="actions"]:hover {
  background-color: var(--button-default-bgColor-hover, #eff2f5);
  border-color: var(--button-default-borderColor-hover, #d1d9e0);
}
#${BUTTON_ID}[data-ghdiff-place="actions"]:active {
  background-color: var(--button-default-bgColor-active, #e6eaef);
  border-color: var(--button-default-borderColor-active, #d1d9e0);
}
#${BUTTON_ID}[data-ghdiff-place="actions"]:focus-visible {
  box-shadow: none;
  outline: 2px solid var(--focus-outline-color, var(--focus-outlineColor, #0969da));
  outline-offset: -2px;
}
/* The old server-rendered tab bar draws its tabs wider and quieter than the
   React one — muted at rest, generous padding, a colour-only hover — so the
   same descendant selector github.com scopes its own rules with scopes ours. */
.tabnav-tabs #${BUTTON_ID} {
  padding-inline: var(--control-medium-paddingInline-spacious, 16px);
  color: var(--fgColor-muted, #59636e);
  transition: color 0.2s cubic-bezier(0.3, 0, 0.5, 1);
}
.tabnav-tabs #${BUTTON_ID}:hover {
  color: var(--fgColor-default, #1f2328);
}
`;

  // The octicon github.com puts on a link that leaves the site — drawn the way
  // github.com draws its own octicons, down to `focusable="false"`, which IE
  // needed to keep a focus ring off `svg`.
  const LINK_EXTERNAL_PATH =
    'M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z';

  /**
   * The diff on screen, or null on any other page. A pull request and a commit
   * are the two github.com pages that are one diff and that ghdiff has an
   * address for; a compare range is the third, and its header carries no
   * control of its own to sit beside.
   */
  function currentTarget() {
    const pull = PULL_PATH.exec(location.pathname);
    if (pull != null) {
      return { kind: 'pull', owner: pull[1], repo: pull[2], number: pull[3] };
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
      ? `/${target.owner}/${target.repo}/pull/${target.number}`
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
    return findRowByLinkTo(`${targetPath(target)}/files`);
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
    const label = document.createElement('span');
    label.textContent = 'ghdiff';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'ghdiff-icon');
    icon.setAttribute('viewBox', '0 0 16 16');
    icon.setAttribute('width', '16');
    icon.setAttribute('height', '16');
    icon.setAttribute('fill', 'currentColor');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', LINK_EXTERNAL_PATH);
    icon.append(path);
    // The icon leads, because in the tab row every tab leads with its own
    // octicon; Primer buttons carry leading visuals just as happily.
    button.append(icon, label);
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
