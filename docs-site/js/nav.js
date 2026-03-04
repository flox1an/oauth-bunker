/**
 * Navigation structure and rendering for the documentation site.
 * Loaded before main.js via a plain <script> tag.
 */

var NAV_SECTIONS = [
  {
    title: 'Getting Started',
    pages: [
      { label: 'Overview', file: 'index.html' },
      { label: 'Quick Start', file: 'getting-started.html' }
    ]
  },
  {
    title: 'Setup',
    pages: [
      { label: 'OAuth Providers', file: 'oauth-setup.html' },
      { label: 'Configuration', file: 'configuration.html' }
    ]
  },
  {
    title: 'Deployment',
    pages: [
      { label: 'Production Deployment', file: 'deployment.html' },
      { label: 'Architecture', file: 'architecture.html' }
    ]
  },
  {
    title: 'Usage',
    pages: [
      { label: 'Admin Guide', file: 'admin-guide.html' },
      { label: 'Troubleshooting', file: 'troubleshooting.html' }
    ]
  }
];

/**
 * Render the sidebar navigation into the #sidebar element.
 * Highlights the current page by matching the end of the pathname
 * so it works with both file:// and http:// protocols.
 */
function renderNav() {
  var sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  var pathname = window.location.pathname;
  var html = '<nav aria-label="Documentation navigation">';

  for (var i = 0; i < NAV_SECTIONS.length; i++) {
    var section = NAV_SECTIONS[i];
    html += '<div class="nav-section">';
    html += '<h3 class="nav-section-title">' + section.title + '</h3>';
    html += '<ul class="nav-list">';

    for (var j = 0; j < section.pages.length; j++) {
      var page = section.pages[j];
      var isActive = pathname.endsWith('/' + page.file) || pathname.endsWith(page.file);
      var activeClass = isActive ? ' class="active"' : '';
      html += '<li' + activeClass + '>';
      html += '<a href="' + page.file + '">' + page.label + '</a>';
      html += '</li>';
    }

    html += '</ul>';
    html += '</div>';
  }

  html += '</nav>';
  sidebar.innerHTML = html;
}
