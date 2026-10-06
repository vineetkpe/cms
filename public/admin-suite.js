(() => {
  if (document.body?.classList.contains('cms-suite-ready')) return;
  const boot = () => {
    document.body.classList.add('cms-suite','cms-suite-ready');
    const main = document.querySelector('main,[role="main"],.main,.workspace,.wrap');
    if (main instanceof HTMLElement) {
      if (!main.id) main.id = 'cmsMainContent';
      main.setAttribute('tabindex','-1');
      const skip = document.createElement('a');
      skip.className = 'cms-skip-link';
      skip.href = `#${main.id}`;
      skip.textContent = 'Skip to main content';
      document.body.prepend(skip);
    }
    if (location.pathname === '/admin/login/' || location.pathname === '/admin/login' || location.pathname === '/admin/preview/' || location.pathname === '/admin/preview') return;

    const items = [
      ['Dashboard','/admin/','⌂'],
      ['Posts','/admin/content/','Aa'],
      ['New article','/admin/editor/','✎'],
      ['Media','/admin/media/','Im'],
      ['Pages & SEO','/admin/pages/','Pg'],
      ['Tools & backups','/admin/tools/','↕'],
      ['Connections','/admin/connections/','Cn'],
      ['Settings','/admin/settings/','St'],
    ];
    const here = location.pathname.replace(/\/+$/,'/') || '/';
    const navHtml = items.map(([label,href,ico]) => {
      const target = href.replace(/\/+$/,'/') || '/';
      const active = here === target;
      return `<a href="${href}" class="${active?'active':''}"${active?' aria-current="page"':''}><span class="cms-nav-ico" aria-hidden="true">${ico}</span><span>${label}</span></a>`;
    }).join('');

    const sidebar = document.createElement('aside');
    sidebar.className = 'cms-global-sidebar';
    sidebar.id = 'cmsGlobalSidebar';
    sidebar.setAttribute('aria-label','CMS navigation');
    sidebar.innerHTML = `
      <div class="cms-brand"><div class="cms-brand-mark">CMS</div><div>Publishing OS</div></div>
      <div class="cms-nav-section">Workspace</div>
      <nav class="cms-global-nav" aria-label="CMS workspace">${navHtml}</nav>
      <div class="cms-nav-section">Website</div>
      <nav class="cms-global-nav" aria-label="Website links"><a href="/" target="_blank" rel="noopener" aria-label="View website (opens in a new tab)"><span class="cms-nav-ico">↗</span><span>View website</span></a><a href="/articles/" target="_blank" rel="noopener" aria-label="Public archive (opens in a new tab)"><span class="cms-nav-ico">Ar</span><span>Public archive</span></a></nav>
      <div class="cms-sidebar-bottom">
        <div class="cms-connection" aria-live="polite"><span class="cms-dot" aria-hidden="true"></span><span id="cmsConnectionText">Admin connected</span></div>
        <div class="cms-user"><div class="cms-avatar" id="cmsAvatar">A</div><div class="cms-user-meta"><div class="cms-user-name" id="cmsUserName">CMS user</div><div class="cms-user-role" id="cmsUserRole">Loading…</div></div></div>
        <button class="cms-logout" id="cmsLogout">Sign out</button>
      </div>`;
    document.body.prepend(sidebar);

    const toggle = document.createElement('button');
    toggle.className = 'cms-mobile-toggle';
    toggle.type = 'button';
    toggle.textContent = '☰';
    toggle.setAttribute('aria-label','Open CMS navigation');
    toggle.setAttribute('aria-controls','cmsGlobalSidebar');
    toggle.setAttribute('aria-expanded','false');

    const isMobile = () => innerWidth < 981;
    const setNav = (open, returnFocus = false) => {
      document.body.classList.toggle('cms-nav-open', Boolean(open));
      toggle.setAttribute('aria-expanded', String(Boolean(open)));
      toggle.setAttribute('aria-label', open ? 'Close CMS navigation' : 'Open CMS navigation');
      sidebar.setAttribute('aria-hidden', String(isMobile() && !open));
      sidebar.inert = isMobile() && !open;
      if (open) {
        const first = sidebar.querySelector('a');
        if (first instanceof HTMLElement) first.focus();
      } else if (returnFocus) toggle.focus();
    };
    setNav(false);
    toggle.onclick = () => setNav(!document.body.classList.contains('cms-nav-open'), true);
    document.body.append(toggle);
    sidebar.addEventListener('click', (event) => { if (event.target.closest('a') && isMobile()) setNav(false); });
    addEventListener('resize', () => {
      if (!isMobile()) {
        document.body.classList.remove('cms-nav-open');
        sidebar.setAttribute('aria-hidden','false');
        sidebar.inert = false;
        toggle.setAttribute('aria-expanded','false');
      } else if (!document.body.classList.contains('cms-nav-open')) {
        sidebar.setAttribute('aria-hidden','true');
        sidebar.inert = true;
      }
    }, { passive:true });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && document.body.classList.contains('cms-nav-open')) setNav(false, true);
    });

    const accessibleName = (el) => {
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return true;
      if ('labels' in el && el.labels?.length) return true;
      return false;
    };
    const humanize = (value) => String(value || '')
      .replace(/[-_]+/g,' ')
      .replace(/([a-z])([A-Z])/g,'$1 $2')
      .trim()
      .replace(/^./, c => c.toUpperCase());
    const enhanceA11y = (root = document) => {
      root.querySelectorAll?.('input,select,textarea').forEach((el) => {
        if (accessibleName(el)) return;
        const candidate = el.getAttribute('placeholder') || el.getAttribute('data-k') || el.id || el.getAttribute('name') || el.getAttribute('type');
        if (candidate) el.setAttribute('aria-label', humanize(candidate));
      });
      root.querySelectorAll?.('button').forEach((button) => {
        if (!button.getAttribute('aria-label') && button.textContent?.trim() === '×') button.setAttribute('aria-label','Remove item');
      });
      root.querySelectorAll?.('th').forEach((th) => {
        th.setAttribute('scope','col');
        if (!th.textContent?.trim()) {
          const hidden=document.createElement('span');
          hidden.className='sr-only';
          hidden.textContent='Actions';
          th.append(hidden);
        }
      });
      root.querySelectorAll?.('.notice,.msg,.message').forEach((el) => {
        el.setAttribute('aria-live','polite');
        el.setAttribute('aria-atomic','true');
      });
    };
    enhanceA11y();
    new MutationObserver((records) => {
      records.forEach((record) => record.addedNodes.forEach((node) => {
        if (node instanceof Element) {
          enhanceA11y(node);
          if (node.matches('input,select,textarea,button,th,.notice,.msg,.message')) enhanceA11y(node.parentElement || node);
        }
      }));
    }).observe(document.body,{childList:true,subtree:true});

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
