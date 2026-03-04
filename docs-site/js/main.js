/**
 * Main initialization script for the documentation site.
 * Must be loaded after nav.js.
 *
 * Features:
 *  - Sidebar navigation rendering
 *  - Dark / light theme toggle (persisted to localStorage)
 *  - Copy-to-clipboard buttons on code blocks
 *  - Hamburger menu for mobile sidebar
 *  - Auto-generated heading anchors for h2/h3
 *  - highlight.js initialization
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Convert arbitrary text to a URL-friendly slug. */
  function slugify(text) {
    return text
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
  }

  // ---------------------------------------------------------------------------
  // Theme toggle
  // ---------------------------------------------------------------------------

  function initTheme() {
    var saved = localStorage.getItem('theme');
    if (saved === 'light') {
      document.body.classList.add('light-mode');
    }

    var btn = document.getElementById('theme-toggle');
    if (!btn) return;

    btn.addEventListener('click', function () {
      document.body.classList.toggle('light-mode');
      var isLight = document.body.classList.contains('light-mode');
      localStorage.setItem('theme', isLight ? 'light' : 'dark');
    });
  }

  // ---------------------------------------------------------------------------
  // Copy buttons on code blocks
  // ---------------------------------------------------------------------------

  function initCopyButtons() {
    var codeBlocks = document.querySelectorAll('pre > code');

    for (var i = 0; i < codeBlocks.length; i++) {
      (function (block) {
        var pre = block.parentNode;
        // Make the pre relatively positioned so the button can sit inside it.
        pre.style.position = 'relative';

        var btn = document.createElement('button');
        btn.className = 'copy-btn';
        btn.textContent = 'Copy';
        btn.setAttribute('type', 'button');
        btn.setAttribute('aria-label', 'Copy code to clipboard');

        btn.addEventListener('click', function () {
          var text = block.innerText;

          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
              showCopied(btn);
            }, function () {
              fallbackCopy(text, btn);
            });
          } else {
            fallbackCopy(text, btn);
          }
        });

        pre.appendChild(btn);
      })(codeBlocks[i]);
    }
  }

  /** Fallback copy for environments without navigator.clipboard (e.g. file://). */
  function fallbackCopy(text, btn) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      showCopied(btn);
    } catch (e) {
      // Silently fail.
    }
    document.body.removeChild(textarea);
  }

  function showCopied(btn) {
    btn.textContent = 'Copied!';
    setTimeout(function () {
      btn.textContent = 'Copy';
    }, 1500);
  }

  // ---------------------------------------------------------------------------
  // Hamburger menu (mobile sidebar toggle)
  // ---------------------------------------------------------------------------

  function initHamburger() {
    var btn = document.getElementById('menu-toggle');
    if (!btn) return;

    btn.addEventListener('click', function () {
      document.body.classList.toggle('sidebar-open');
    });
  }

  // ---------------------------------------------------------------------------
  // Heading anchors
  // ---------------------------------------------------------------------------

  function initHeadingAnchors() {
    var main = document.querySelector('main');
    if (!main) return;

    var headings = main.querySelectorAll('h2, h3');

    for (var i = 0; i < headings.length; i++) {
      var heading = headings[i];
      var text = heading.textContent || '';
      var id = slugify(text);

      // Avoid duplicate ids on the same page.
      if (document.getElementById(id)) {
        id = id + '-' + i;
      }

      heading.id = id;

      var anchor = document.createElement('a');
      anchor.href = '#' + id;
      anchor.className = 'heading-anchor';
      anchor.innerHTML = heading.innerHTML;
      heading.innerHTML = '';
      heading.appendChild(anchor);
    }
  }

  // ---------------------------------------------------------------------------
  // highlight.js
  // ---------------------------------------------------------------------------

  function initHighlight() {
    if (typeof hljs !== 'undefined') {
      hljs.highlightAll();
    }
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    // Render sidebar navigation (renderNav is defined in nav.js).
    if (typeof renderNav === 'function') {
      renderNav();
    }

    initTheme();
    initCopyButtons();
    initHamburger();
    initHeadingAnchors();
    initHighlight();
  });
})();
