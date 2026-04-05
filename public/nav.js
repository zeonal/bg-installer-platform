/**
 * nav.js — Mobile navigation drawer for BG Installer Platform.
 * Include on every page. Injects:
 *   1. A fixed top bar (logo + page title + hamburger button)
 *   2. A full-screen overlay that closes the drawer on tap
 * Works by toggling `body.sidebar-open` which CSS handles.
 */
(function () {
  // ── Derive page title from <title> tag ─────────────────────────────────────
  const rawTitle  = document.title || '';
  const pageTitle = rawTitle.split('—')[0].trim() || 'BG Platform';

  // ── Inject overlay ─────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  document.body.appendChild(overlay);

  // ── Inject mobile top bar ──────────────────────────────────────────────────
  const topbar = document.createElement('header');
  topbar.className = 'mobile-topbar';
  topbar.setAttribute('role', 'banner');
  topbar.innerHTML = `
    <div class="mobile-topbar-brand">
      <img src="/images/bg-logo.svg" alt="BG Logo"
           onerror="this.style.display='none'" />
      <div class="mobile-topbar-title">
        <span>BG</span> ${escapeHtml(pageTitle)}
      </div>
    </div>
    <button class="mobile-hamburger" id="mobileMenuBtn"
            aria-label="Open navigation menu"
            aria-expanded="false"
            aria-controls="appSidebar">
      <i class="fa-solid fa-bars" id="hamburgerIcon"></i>
    </button>
  `;
  document.body.prepend(topbar);

  // Give the sidebar an id so aria-controls works
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) sidebar.id = 'appSidebar';

  // ── Toggle helpers ─────────────────────────────────────────────────────────
  function openDrawer() {
    document.body.classList.add('sidebar-open');
    document.getElementById('mobileMenuBtn').setAttribute('aria-expanded', 'true');
    document.getElementById('hamburgerIcon').className = 'fa-solid fa-xmark';
    document.body.style.overflow = 'hidden'; // prevent background scroll
  }

  function closeDrawer() {
    document.body.classList.remove('sidebar-open');
    document.getElementById('mobileMenuBtn').setAttribute('aria-expanded', 'false');
    document.getElementById('hamburgerIcon').className = 'fa-solid fa-bars';
    document.body.style.overflow = '';
  }

  function toggleDrawer() {
    document.body.classList.contains('sidebar-open') ? closeDrawer() : openDrawer();
  }

  // ── Wire up events ─────────────────────────────────────────────────────────
  document.getElementById('mobileMenuBtn').addEventListener('click', toggleDrawer);
  overlay.addEventListener('click', closeDrawer);

  // Close drawer when any nav link is tapped (gives instant feel)
  document.addEventListener('click', (e) => {
    const link = e.target.closest('.nav-item, .btn-logout');
    if (link && document.body.classList.contains('sidebar-open')) {
      // Small delay so the page transition feels intentional
      setTimeout(closeDrawer, 120);
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
})();
