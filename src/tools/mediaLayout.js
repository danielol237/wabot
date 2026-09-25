// ARIA Media Unified Frontend Layout & UI Components Shell

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function svgIcon(name) {
  const icons = {
    aria: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    home: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    anime: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    movies: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>`,
    series: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>`,
    cartoons: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`,
    kids: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    search: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    library: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
    downloads: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    recommend: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
  };
  return icons[name] || "";
}

function mediaLayout(title, activeSection, content) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#090B0E">
  <title>${esc(title)} · ARIA Media</title>
  <style>
    :root {
      --bg: #090B0E;
      --surface: #0E1115;
      --surface-2: #13171C;
      --surface-3: #1A2027;
      --line: #20262D;
      --text: #F2F4F7;
      --muted: #8B949E;
      --subtle: #5F6872;
      --accent: #ff5d6c;
      --accent-2: #ff8a5b;
      --radius: 12px;
      --shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
      line-height: 1.5;
      display: flex;
      min-height: 100vh;
    }
    a { color: inherit; text-decoration: none; }

    /* Sidebar Layout for Desktop */
    .app-sidebar {
      width: 240px;
      background: var(--surface);
      border-right: 1px solid var(--line);
      display: flex;
      flex-direction: column;
      position: fixed;
      top: 0; bottom: 0; left: 0;
      z-index: 100;
      padding: 20px 16px;
    }
    .brand-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--line);
    }
    .brand-header img {
      width: 32px;
      height: 32px;
    }
    .brand-title {
      font-size: 16px;
      font-weight: 800;
      letter-spacing: 0.05em;
    }
    .brand-title span { color: var(--accent); }

    .nav-group {
      margin-top: 24px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .nav-group-label {
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--subtle);
      margin-bottom: 8px;
      padding-left: 12px;
    }
    .nav-link {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      color: var(--muted);
      transition: all 0.15s ease;
    }
    .nav-link:hover, .nav-link.active {
      background: var(--surface-2);
      color: var(--text);
    }
    .nav-link.active {
      border-left: 3px solid var(--accent);
    }

    /* Main Content Area */
    .app-main {
      margin-left: 240px;
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .app-header {
      height: 64px;
      background: rgba(9, 11, 14, 0.9);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--line);
      position: sticky; top: 0;
      z-index: 90;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 28px;
    }
    .global-search {
      display: flex;
      align-items: center;
      gap: 10px;
      background: var(--surface-2);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 14px;
      width: 320px;
    }
    .global-search input {
      background: transparent;
      border: 0;
      color: var(--text);
      font-size: 13px;
      outline: 0;
      width: 100%;
    }

    .main-viewport {
      padding: 28px;
      max-width: 1400px;
      margin: 0 auto;
      width: 100%;
    }

    /* Mobile Navigation */
    .mobile-bottom-nav {
      display: none;
      position: fixed;
      bottom: 0; left: 0; right: 0;
      height: 60px;
      background: var(--surface);
      border-top: 1px solid var(--line);
      z-index: 100;
      justify-content: space-around;
      align-items: center;
    }
    .mobile-nav-link {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      color: var(--muted);
    }
    .mobile-nav-link.active { color: var(--accent); }

    @media (max-width: 850px) {
      .app-sidebar { display: none; }
      .app-main { margin-left: 0; }
      .mobile-bottom-nav { display: flex; }
      .main-viewport { padding: 18px 14px 80px; }
      .global-search { width: 100%; }
    }
  </style>
</head>
<body>
  <aside class="app-sidebar">
    <div class="brand-header">
      <img src="/aria-mark.png" alt="ARIA">
      <div class="brand-title">ARIA <span>MEDIA</span></div>
    </div>

    <div class="nav-group">
      <div class="nav-group-label">Ecosystem</div>
      <a class="nav-link ${activeSection === "home" ? "active" : ""}" href="/media">${svgIcon("home")} Home</a>
      <a class="nav-link ${activeSection === "anime" ? "active" : ""}" href="/anime">${svgIcon("anime")} Anime</a>
      <a class="nav-link ${activeSection === "movies" ? "active" : ""}" href="/movies">${svgIcon("movies")} Movies</a>
      <a class="nav-link ${activeSection === "series" ? "active" : ""}" href="/series">${svgIcon("series")} Series / TV</a>
      <a class="nav-link ${activeSection === "cartoons" ? "active" : ""}" href="/cartoons">${svgIcon("cartoons")} Cartoons</a>
      <a class="nav-link ${activeSection === "kids" ? "active" : ""}" href="/kids">${svgIcon("kids")} Kids</a>
    </div>

    <div class="nav-group">
      <div class="nav-group-label">Discovery</div>
      <a class="nav-link ${activeSection === "recommend" ? "active" : ""}" href="/anime/recommend">${svgIcon("recommend")} Discovery Engine</a>
    </div>

    <div class="nav-group">
      <div class="nav-group-label">Library</div>
      <a class="nav-link ${activeSection === "library" ? "active" : ""}" href="/library">${svgIcon("library")} My Library</a>
      <a class="nav-link ${activeSection === "downloads" ? "active" : ""}" href="/downloads">${svgIcon("downloads")} Downloads</a>
    </div>
  </aside>

  <div class="app-main">
    <header class="app-header">
      <form class="global-search" action="/media/search" method="get">
        ${svgIcon("search")}
        <input name="q" placeholder="Search Anime, Movies, Series..." autocomplete="off">
      </form>
      <div>
        <a href="/portal/login" style="font-size: 12px; font-weight: 700; color: var(--muted);">Sign In</a>
      </div>
    </header>

    <main class="main-viewport">
      ${content}
    </main>
  </div>

  <nav class="mobile-bottom-nav">
    <a class="mobile-nav-link ${activeSection === "home" ? "active" : ""}" href="/media">${svgIcon("home")} Home</a>
    <a class="mobile-nav-link ${activeSection === "anime" ? "active" : ""}" href="/anime">${svgIcon("anime")} Anime</a>
    <a class="mobile-nav-link ${activeSection === "movies" ? "active" : ""}" href="/movies">${svgIcon("movies")} Movies</a>
    <a class="mobile-nav-link ${activeSection === "library" ? "active" : ""}" href="/library">${svgIcon("library")} Library</a>
  </nav>
</body>
</html>`;
}

module.exports = {
  mediaLayout,
  svgIcon,
  esc,
};
