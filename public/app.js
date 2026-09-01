(() => {
  const CACHE_KEY = 'me_and_you_ui_v1';
  const state = {
    route: location.pathname || '/',
    view: 'chats',
    activeChat: null,
    chats: [],
    messages: {},
    hydrated: false
  };

  const demoChats = [
    { id: 'welcome', name: 'Me and You', initials: 'M', preview: 'Your chats will stay here.', time: '', unread: 0 }
  ];

  function readCache() {
    try {
      const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!saved) return;
      if (Array.isArray(saved.chats)) state.chats = saved.chats;
      if (saved.messages && typeof saved.messages === 'object') state.messages = saved.messages;
      if (saved.view === 'chats' || saved.view === 'settings') state.view = saved.view;
      if (saved.activeChat) state.activeChat = saved.activeChat;
    } catch (_) {}
  }

  function writeCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        chats: state.chats,
        messages: state.messages,
        view: state.view,
        activeChat: state.activeChat
      }));
    } catch (_) {}
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function renderShell() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <main class="phone">
        <header class="topbar">
          <div class="brand">Me and You</div>
          <div id="connection" class="status">Connecting…</div>
        </header>
        <section id="content" class="content"></section>
        <nav class="bottom">
          <button data-nav="chats" class="active">Chats</button>
          <button data-nav="contacts">Contacts</button>
          <button data-nav="settings">Settings</button>
        </nav>
      </main>`;
    document.querySelectorAll('[data-nav]').forEach(btn => btn.addEventListener('click', () => navigate('/' + btn.dataset.nav)));
  }

  function renderChats() {
    const chats = state.chats.length ? state.chats : demoChats;
    document.getElementById('content').innerHTML = `
      <div class="view">
        <div class="list-head"><h1>Chats</h1><button class="icon-btn" aria-label="New chat">＋</button></div>
        <input class="search" placeholder="Search or start new chat" autocomplete="off">
        <div class="chat-list">${chats.map(chat => `
          <button class="chat" data-chat="${escapeHtml(chat.id)}">
            <div class="avatar">${escapeHtml(chat.initials || chat.name?.[0] || '?')}</div>
            <div class="chat-main">
              <div class="chat-top"><span class="name">${escapeHtml(chat.name)}</span><span class="time">${escapeHtml(chat.time || '')}</span></div>
              <div class="preview">${escapeHtml(chat.preview || '')}</div>
            </div>
          </button>`).join('')}</div>
      </div>`;
    document.querySelectorAll('[data-chat]').forEach(el => el.addEventListener('click', () => navigate('/chat/' + encodeURIComponent(el.dataset.chat))));
    document.querySelector('.search')?.addEventListener('input', e => filterChats(e.target.value));
    setActiveNav('chats');
  }

  function filterChats(query) {
    const q = query.trim().toLowerCase();
    document.querySelectorAll('[data-chat]').forEach(el => {
      const name = el.querySelector('.name')?.textContent.toLowerCase() || '';
      el.hidden = q && !name.includes(q);
    });
  }

  function renderChat(id) {
    const chats = state.chats.length ? state.chats : demoChats;
    const chat = chats.find(c => c.id === id) || { id, name: 'Chat', initials: '?', preview: '' };
    const messages = Array.isArray(state.messages[id]) ? state.messages[id] : [];
    document.getElementById('content').innerHTML = `
      <div class="chat-view">
        <header class="chat-head">
          <button class="back" id="back" aria-label="Back">‹</button>
          <div class="avatar">${escapeHtml(chat.initials || chat.name?.[0] || '?')}</div>
          <div><div class="chat-name">${escapeHtml(chat.name)}</div><div class="chat-state">Connecting…</div></div>
        </header>
        <div class="messages" id="messages">${messages.length ? messages.map(messageHtml).join('') : '<div class="empty">Your messages will appear here instantly from the local cache, then sync in the background.</div>'}</div>
        <form class="composer" id="composer"><input id="message" placeholder="Message" autocomplete="off"><button class="send" aria-label="Send">➤</button></form>
      </div>`;
    document.getElementById('back').onclick = () => navigate('/chats');
    document.getElementById('composer').onsubmit = e => { e.preventDefault(); sendMessage(id); };
    setTimeout(() => document.getElementById('messages')?.scrollTo(0, 999999), 0);
  }

  function messageHtml(m) {
    return `<div class="bubble ${m.from === 'me' ? 'me' : ''}">${escapeHtml(m.text)}<small>${formatTime(m.createdAt)}</small></div>`;
  }

  function sendMessage(id) {
    const input = document.getElementById('message');
    const text = input?.value.trim();
    if (!text) return;
    if (!state.messages[id]) state.messages[id] = [];
    state.messages[id].push({ id: crypto.randomUUID?.() || String(Date.now()), from: 'me', text, createdAt: new Date().toISOString() });
    const chat = state.chats.find(c => c.id === id);
    if (chat) { chat.preview = text; chat.time = formatTime(new Date().toISOString()); }
    writeCache();
    renderChat(id);
  }

  function renderContacts() {
    document.getElementById('content').innerHTML = '<div class="view"><div class="list-head"><h1>Contacts</h1></div><div class="empty">Contacts will be added here.</div></div>';
    setActiveNav('contacts');
  }

  function renderSettings() {
    document.getElementById('content').innerHTML = '<div class="view"><div class="list-head"><h1>Settings</h1></div><div class="empty">Account, privacy, notifications and app settings will live here.</div></div>';
    setActiveNav('settings');
  }

  function setActiveNav(view) {
    document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === view));
  }

  function render() {
    if (state.route.startsWith('/chat/')) return renderChat(decodeURIComponent(state.route.slice(6)));
    if (state.route === '/contacts') return renderContacts();
    if (state.route === '/settings') return renderSettings();
    state.route = '/chats';
    history.replaceState({}, '', '/chats');
    renderChats();
  }

  function navigate(url) {
    if (location.pathname === url) return;
    history.pushState({}, '', url);
    state.route = url;
    render();
  }

  window.addEventListener('popstate', () => { state.route = location.pathname; render(); });

  async function boot() {
    // Critical rule: paint cached UI before any network/Firebase work.
    readCache();
    renderShell();
    render();
    state.hydrated = true;

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    // Firebase sync will be plugged into this point later. The UI is already usable.
    requestAnimationFrame(() => {
      const connection = document.getElementById('connection');
      if (connection) connection.textContent = 'Ready';
    });
  }

  boot();
})();
