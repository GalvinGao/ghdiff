// ==UserScript==
// @name         ghdiff
// @namespace    https://ghdiff.com/
// @version      1.4.1
// @description  Adds a ghdiff button to the tab row of every pull request and merge request, and beside Browse files on every commit.
// @author       GalvinGao
// @homepageURL  https://github.com/GalvinGao/ghdiff
// @supportURL   https://github.com/GalvinGao/ghdiff/issues
// @downloadURL  __GHDIFF_ORIGIN__/ghdiff.user.js
// @updateURL    __GHDIFF_ORIGIN__/ghdiff.user.js
// @match        __GHDIFF_MATCHES__
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

import { matchLocale } from './lib/matchLocale';
import { m } from './paraglide/messages.js';
import { baseLocale, locales } from './paraglide/runtime.js';

function userscriptLocale() {
  const language = document.documentElement.lang;
  return matchLocale(language, locales) ?? baseLocale;
}

// The match is every page on the hosts this deployment serves, not the review
// paths alone. GitHub and GitLab both move between their own pages without
// reloading the document, and a userscript manager runs a script once per
// document, so a script that only matched the review paths would never start
// for a reviewer who arrived from the repository's own list.

(() => {
  'use strict';

  const APP_ORIGIN = '__GHDIFF_ORIGIN__';
  // The hosts this deployment serves, ports included. A match pattern cannot
  // name a port, so `gitlab.corp.com:8443` matches every port on that name;
  // this is the check that keeps the button to the one that is served.
  const SERVED_HOSTS = '__GHDIFF_HOSTS__'.split(',');
  if (!SERVED_HOSTS.includes(location.host)) return;
  const BUTTON_ID = 'ghdiff-open-button';
  const STYLE_ID = 'ghdiff-open-style';

  // The button wears two skins on github.com, both read off the live page, and
  // GitLab's own classes dress it there — the same philosophy, one stylesheet.
  // `data-ghdiff-forge` scopes every GitHub rule, so a GitLab page gets none
  // of them; `data-ghdiff-place` picks the skin within a forge.
  //
  // In a pull request's tab row it is another one of github.com's own tabs —
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
  //
  // On GitLab there is no skin to copy: the merge request's tab bar styles any
  // `li > a` of its own, so the button arrives as one, and the commit header's
  // own `gl-button` classes dress it beside Browse files. The octicon is
  // github.com's habit, so GitLab draws no icon at all.
  const STYLE = `
#${BUTTON_ID}[data-ghdiff-forge="github"] {
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
#${BUTTON_ID}[data-ghdiff-forge="github"] .ghdiff-icon {
  flex: 0 0 auto;
  color: var(--fgColor-muted, #59636e);
}
#${BUTTON_ID}[data-ghdiff-forge="gitlab"] .ghdiff-icon {
  display: none;
}
#${BUTTON_ID}[data-ghdiff-forge="github"][data-ghdiff-place="tabs"] {
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
#${BUTTON_ID}[data-ghdiff-forge="github"][data-ghdiff-place="tabs"]:focus-visible {
  outline: var(--focus-outline, 2px solid var(--focus-outlineColor, #0969da));
  outline-offset: -6px;
}
@media (max-width: 575.98px) {
  #${BUTTON_ID}[data-ghdiff-forge="github"][data-ghdiff-place="tabs"] .ghdiff-icon {
    display: none;
  }
}
#${BUTTON_ID}[data-ghdiff-forge="github"][data-ghdiff-place="actions"] {
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
#${BUTTON_ID}[data-ghdiff-forge="github"][data-ghdiff-place="actions"]:hover {
  background-color: var(--button-default-bgColor-hover, #eff2f5);
  border-color: var(--button-default-borderColor-hover, #d1d9e0);
}
#${BUTTON_ID}[data-ghdiff-forge="github"][data-ghdiff-place="actions"]:active {
  background-color: var(--button-default-bgColor-active, #e6eaef);
  border-color: var(--button-default-borderColor-active, #d1d9e0);
}
#${BUTTON_ID}[data-ghdiff-forge="github"][data-ghdiff-place="actions"]:focus-visible {
  box-shadow: none;
  outline: 2px solid var(--focus-outline-color, var(--focus-outlineColor, #0969da));
  outline-offset: -2px;
}
/* The old server-rendered tab bar draws its tabs wider and quieter than the
   React one — muted at rest, generous padding, a colour-only hover — so the
   same descendant selector github.com scopes its own rules with scopes ours. */
.tabnav-tabs #${BUTTON_ID}[data-ghdiff-forge="github"] {
  padding-inline: var(--control-medium-paddingInline-spacious, 16px);
  color: var(--fgColor-muted, #59636e);
  transition: color 0.2s cubic-bezier(0.3, 0, 0.5, 1);
}
.tabnav-tabs #${BUTTON_ID}[data-ghdiff-forge="github"]:hover {
  color: var(--fgColor-default, #1f2328);
}
`;

  // The octicon github.com puts on a link that leaves the site — drawn the way
  // github.com draws its own octicons, down to `focusable="false"`, which IE
  // needed to keep a focus ring off `svg`.
  const LINK_EXTERNAL_PATH =
    'M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z';

  // ---------------------------------------------------------------------------
  // What the drivers share. A driver is one forge's whole answer — the URL
  // grammar, the ghdiff address, the title, the row the button belongs to,
  // what it arrives as and how it is dressed — so the loop below never asks
  // which forge it is looking at.
  // ---------------------------------------------------------------------------

  // No selector either forge gives is a contract, and GitHub has already
  // replaced the pull request header once. So no row is looked up by name.
  // What each one *is* is the row that holds the link to one page — Files
  // changed or Changes for a review, Browse files for a commit — so find that
  // link and take the row it sits in.
  //
  // A link with a fragment or a query is not it: the page's own skip link
  // resolves to the same path. A link that is not on screen is not it either,
  // and the commit header holds two of them — a wide one with the words and a
  // narrow icon, one of which is always hidden. They share the one row, so
  // whichever is on screen answers.
  function isPlainVisibleLinkTo(link, path) {
    const href = link.getAttribute('href');
    if (href == null) return false;
    const url = new URL(href, location.href);
    if (url.pathname !== path) return false;
    if (url.hash !== '' || url.search !== '') return false;
    return link.offsetParent != null;
  }

  function findRowByLinkTo(path) {
    for (const link of document.querySelectorAll('a[href]')) {
      if (!isPlainVisibleLinkTo(link, path)) continue;
      const row = link.parentElement;
      if (row != null && row.children.length > 1) return row;
    }
    return null;
  }

  // Browse files links to this commit's own tree page, and its row is the
  // header's action row. The forge's own navigation links to the same tree —
  // GitLab's sidebar keeps a Repository item for the ref on screen — and once
  // Vue has rendered it, it comes first, so a link inside the navigation is
  // never the one.
  function findCommitRow(treePath) {
    for (const link of document.querySelectorAll('a[href]')) {
      if (!isPlainVisibleLinkTo(link, treePath)) continue;
      if (link.closest('nav, aside, [role="navigation"]') != null) continue;
      const row = link.parentElement;
      if (row != null && row.children.length > 1) return row;
    }
    return null;
  }

  // On screen, not merely present: GitLab keeps a skeleton of the tab bar in
  // the document while the real one loads, and a hidden element still answers
  // `offsetParent`. `checkVisibility` reads display, visibility and opacity;
  // the size check is the fallback for a browser without it.
  function isOnScreen(element) {
    if (typeof element.checkVisibility === 'function') {
      return element.checkVisibility({
        checkVisibilityCSS: true,
        opacityProperty: true,
        visibilityProperty: true,
      });
    }
    const rect = element.getBoundingClientRect();
    return element.offsetParent != null && rect.width > 0 && rect.height > 0;
  }

  // Inside the viewport right now: between two on-screen bars, the one the
  // reviewer is looking at wins, and the button follows on the next sync.
  function isInViewport(element) {
    const rect = element.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  }

  const github = (() => {
    const PULL_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/;
    const COMMIT_PATH =
      /^\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]{7,40})(?:\/|$)/i;

    // github.com writes the file part of a diff anchor as the SHA-256 of the
    // path, and ghdiff reads that form, so a reviewer who followed a link to
    // one file keeps that file. Every other fragment github.com writes — a
    // comment, a commit, the skip link — names something ghdiff has no address
    // for, and carrying one over would put a fragment in the bar that resolves
    // to nothing.
    const DIFF_HASH = /^#diff-[0-9a-f]{64}(?:[LR]\d+(?:-[LR]\d+)?)?$/;

    // The row of tabs, in the two headers GitHub serves today. The React
    // header names its own classes with a hash per build, so `aria-label` is
    // the one thing on it that a script can hold to.
    const TAB_LISTS = [
      'nav[aria-label="Pull request navigation"] > *',
      '.tabnav-tabs',
    ];

    // A pull request and a commit are the two github.com pages that are one
    // diff and that ghdiff has an address for; a compare range is the third,
    // and its header carries no control of its own to sit beside.
    function detect() {
      const pull = PULL_PATH.exec(location.pathname);
      if (pull != null) {
        return {
          kind: 'pull',
          path: `/${pull[1]}/${pull[2]}/pull/${pull[3]}`,
        };
      }
      const commit = COMMIT_PATH.exec(location.pathname);
      if (commit != null) {
        return {
          kind: 'commit',
          path: `/${commit[1]}/${commit[2]}/commit/${commit[3]}`,
          treePath: `/${commit[1]}/${commit[2]}/tree/${commit[3]}`,
        };
      }
      return null;
    }

    // The canonical ghdiff address is the host glued to the path with a colon.
    function href(target) {
      const hash = DIFF_HASH.test(location.hash) ? location.hash : '';
      return `${APP_ORIGIN}/github.com:${target.path.slice(1)}${hash}`;
    }

    function title(target) {
      return target.kind === 'pull'
        ? m.userscript_open_pull({}, { locale: userscriptLocale() })
        : m.userscript_open_commit({}, { locale: userscriptLocale() });
    }

    function host(target) {
      if (target.kind === 'commit') return findCommitRow(target.treePath);
      for (const selector of TAB_LISTS) {
        const found = document.querySelector(selector);
        if (found != null) return found;
      }
      return findRowByLinkTo(`${target.path}/files`);
    }

    function mount() {
      return button;
    }

    function dress(target) {
      button.dataset.ghdiffForge = 'github';
      button.dataset.ghdiffPlace = target.kind === 'pull' ? 'tabs' : 'actions';
      setClass(button, '');
      setClass(label, '');
    }

    return { detect, href, title, host, mount, dress };
  })();

  const gitlab = (() => {
    // GitLab marks its pages with a `-` separator, so a path holding one is a
    // GitLab path. The match stops at the merge request or the commit itself:
    // the tabs under one (`/diffs`, `/commits`) all name the same diff.
    const MR_PATH = /^(\/.+?\/-\/merge_requests\/\d+)(?:\/|$)/;
    const COMMIT_PATH = /^(\/.+?\/-\/commit\/[0-9a-f]{7,40})(?:\/|$)/i;

    function detect() {
      const path = location.pathname;
      if (!path.includes('/-/')) return null;
      const mr = MR_PATH.exec(path);
      if (mr != null) return { kind: 'pull', path: mr[1] };
      const commit = COMMIT_PATH.exec(path);
      if (commit != null) {
        return {
          kind: 'commit',
          path: commit[1],
          treePath: commit[1].replace('/-/commit/', '/-/tree/'),
        };
      }
      return null;
    }

    // The canonical address glues the page's own host — port included — to
    // the path with a colon. No fragment comes over: ghdiff resolves no
    // anchor form GitLab writes.
    function href(target) {
      return `${APP_ORIGIN}/${location.host}:${target.path.slice(1)}`;
    }

    function title(target) {
      return target.kind === 'pull'
        ? m.userscript_open_merge_request({}, { locale: userscriptLocale() })
        : m.userscript_open_commit({}, { locale: userscriptLocale() });
    }

    // The Changes tab links to this merge request's own /diffs page, and the
    // list it sits in is the tab bar. It is not the only plain link to that
    // address — the breadcrumb names the merge request too, and once Vue has
    // rendered it, it comes first — and a page can hold two such bars at
    // once: the inline one and a skeleton or a sticky clone that is never on
    // screen. So among the lists that also hold the tab to the merge request
    // itself — the company a breadcrumb never keeps — the bar is the first
    // one actually on screen.
    function findTabBar(mrPath) {
      const bars = [];
      for (const link of document.querySelectorAll('a[href]')) {
        if (!isPlainVisibleLinkTo(link, `${mrPath}/diffs`)) continue;
        const ul = link.closest('ul');
        if (ul == null || bars.includes(ul)) continue;
        for (const tab of ul.querySelectorAll('a[href]')) {
          const url = new URL(tab.getAttribute('href'), location.href);
          if (url.pathname === mrPath) {
            bars.push(ul);
            break;
          }
        }
      }
      const onScreen = bars.filter(isOnScreen);
      return onScreen.find(isInViewport) ?? onScreen[0] ?? bars[0] ?? null;
    }

    function host(target) {
      return target.kind === 'commit'
        ? findCommitRow(target.treePath)
        : findTabBar(target.path);
    }

    // A GitLab tab bar expects its tabs to be `li`s, so the button goes in
    // one there; everywhere else it is appended itself.
    function mount(target) {
      if (target.kind !== 'pull') return button;
      if (button.parentElement !== listItem) listItem.append(button);
      return listItem;
    }

    // Beside Browse files the button wears the page's own button classes;
    // everywhere else the stylesheet alone dresses it.
    function dress(target) {
      button.dataset.ghdiffForge = 'gitlab';
      const place = target.kind === 'pull' ? 'tabs' : 'actions';
      button.dataset.ghdiffPlace = place;
      setClass(
        button,
        target.kind === 'commit' ? 'gl-button btn btn-md btn-default' : ''
      );
      setClass(label, target.kind === 'commit' ? 'gl-button-text' : '');
    }

    return { detect, href, title, host, mount, dress };
  })();

  // GitLab's grammar is the marked one, so it answers first; a path that
  // matches neither is no diff this script has an address for.
  const DRIVERS = [gitlab, github];

  function activeDriver() {
    for (const driver of DRIVERS) {
      const target = driver.detect();
      if (target != null) return { driver, target };
    }
    return null;
  }

  const button = (() => {
    const element = document.createElement('a');
    element.id = BUTTON_ID;
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'ghdiff-icon');
    icon.setAttribute('viewBox', '0 0 16 16');
    icon.setAttribute('width', '16');
    icon.setAttribute('height', '16');
    icon.setAttribute('fill', 'currentColor');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    const iconPath = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'path'
    );
    iconPath.setAttribute('d', LINK_EXTERNAL_PATH);
    icon.append(iconPath);
    // The icon leads, because in github.com's tab row every tab leads with its
    // own octicon; Primer buttons carry leading visuals just as happily.
    element.append(icon, document.createElement('span'));
    return element;
  })();
  const label = button.querySelector('span');

  // A GitLab merge request's tab bar expects its tabs to be `li`s — see the
  // driver's `mount`; the core owns both nodes and retires whichever is idle.
  const listItem = document.createElement('li');

  // The observer below watches `class`, and an assignment reports a mutation
  // even when the value is the one already there — so a class is written only
  // when it changes, or every sync would schedule the next one.
  function setClass(element, value) {
    if (element.className !== value) element.className = value;
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID) != null) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    (document.head ?? document.documentElement).append(style);
  }

  function sync() {
    const found = activeDriver();
    const host = found == null ? null : found.driver.host(found.target);
    if (found == null || host == null) {
      button.remove();
      listItem.remove();
      return;
    }
    const { driver, target } = found;
    installStyle();
    // A move between targets reuses this button, so everything that differs
    // between them is written on every sync and not once at build time.
    const href = driver.href(target);
    if (button.getAttribute('href') !== href) button.setAttribute('href', href);
    driver.dress(target);
    const title = driver.title(target);
    if (button.title !== title) button.title = title;
    const placed = driver.mount(target);
    if (placed !== listItem) listItem.remove();
    // The forge's own renderer owns these rows and re-renders them, which
    // drops anything it did not put there. Appending is what brings the
    // button back. Appending only when it is not already the last child is
    // what keeps this from answering its own observer for ever.
    if (placed.parentElement !== host || placed.nextElementSibling != null) {
      host.append(placed);
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

  label.textContent = 'ghdiff';
  sync();

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
    // A bar's life after it is added is class-driven: GitLab shows the
    // skeleton and hides the real one (and back) by rewriting `class`, which
    // is no childList mutation at all.
    attributes: true,
    attributeFilter: ['class', 'style'],
  });
  // A move between files inside one page changes the address and nothing else,
  // so neither of these has a mutation to report. A scroll reports nothing
  // either, and it is what brings the sticky bar on screen.
  window.addEventListener('hashchange', schedule);
  window.addEventListener('popstate', schedule);
  window.addEventListener('scroll', schedule, { capture: true, passive: true });
})();
