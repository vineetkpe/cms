(() => {
  if (document.body?.classList.contains('cms-suite-ready')) return;
  const boot = () => {
    document.body.classList.add('cms-suite','cms-suite-ready');
    if (location.pathname === '/admin/login/' || location.pathname === '/admin/login' || location.pathname === '/admin/preview/' || location.pathname === '/admin/preview') return;

    const items = [
      ['Dashboard','/admin/','⌂'],
      ['Posts','/admin/content/','Aa'],
      ['New article','/admin/editor/','✎'],
      ['Media','/admin/media/','Im'],
      ['Pages & SEO','/admin/pages/','Pg'],
      ['Tools & backups','/admin/tools/','↕'],
      ['Settings','/admin/settings/','St'],
    ];
    const here = location.pathname.replace(/\/+$/,'/') || '/';
    const navHtml = items.map(([label,href,ico]) => {
      const target = href.replace(/\/+$/,'/') || '/';
      const active = here === target || (href === '/admin/content/' && location.hash === '#redirects');
      return `<a href="${href}" class="${active?'active':''}"><span class="cms-nav-ico">${ico}</span><span>${label}</span></a>`;
    }).join('');

    const sidebar = document.createElement('aside');
    sidebar.className = 'cms-global-sidebar';
    sidebar.innerHTML = `
      <div class="cms-brand"><div class="cms-brand-mark">CMS</div><div>Publishing OS</div></div>
      <div class="cms-nav-section">Workspace</div>
      <nav class="cms-global-nav">${navHtml}</nav>
      <div class="cms-nav-section">Website</div>
      <nav class="cms-global-nav"><a href="/" target="_blank"><span class="cms-nav-ico">↗</span><span>View website</span></a><a href="/articles/" target="_blank"><span class="cms-nav-ico">Ar</span><span>Public archive</span></a></nav>
      <div class="cms-sidebar-bottom">
        <div class="cms-connection"><span class="cms-dot"></span><span id="cmsConnectionText">Admin connected</span></div>
        <div class="cms-user"><div class="cms-avatar" id="cmsAvatar">A</div><div class="cms-user-meta"><div class="cms-user-name" id="cmsUserName">CMS user</div><div class="cms-user-role" id="cmsUserRole">Loading…</div></div></div>
        <button class="cms-logout" id="cmsLogout">Sign out</button>
      </div>`;
    document.body.prepend(sidebar);

    const toggle = document.createElement('button');
    toggle.className = 'cms-mobile-toggle';
    toggle.type = 'button';
    toggle.textContent = '☰';
    toggle.setAttribute('aria-label','Open CMS navigation');
    toggle.onclick = () => document.body.classList.toggle('cms-nav-open');
    document.body.append(toggle);
    sidebar.addEventListener('click', (event) => { if (event.target.closest('a') && innerWidth < 981) document.body.classList.remove('cms-nav-open'); });

    fetch('/api/admin/login',{credentials:'same-origin',cache:'no-store'}).then(async r => {
      const data = await r.json().catch(()=>({}));
      if (!r.ok || !data.authenticated) throw new Error('Session expired');
      const user = data.user || {};
      const name = user.displayName || user.username || 'CMS user';
      const role = user.role || 'member';
      const nameEl = document.querySelector('#cmsUserName'); if (nameEl) nameEl.textContent = name;
      const roleEl = document.querySelector('#cmsUserRole'); if (roleEl) roleEl.textContent = role;
      const avatar = document.querySelector('#cmsAvatar'); if (avatar) avatar.textContent = name.trim().slice(0,1).toUpperCase() || 'A';
    }).catch(() => {
      const text = document.querySelector('#cmsConnectionText'); if (text) text.textContent = 'Session check failed';
    });

    document.querySelector('#cmsLogout')?.addEventListener('click', async () => {
      await fetch('/api/admin/login',{method:'DELETE',credentials:'same-origin'}).catch(()=>{});
      location.replace('/admin/login/');
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
