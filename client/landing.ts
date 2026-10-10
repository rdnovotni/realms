import type { GameSession } from './session.js';

type AccessTab = 'login' | 'signup' | 'recovery';
let activeTab: AccessTab = 'login';
const pages: Record<string, string> = {
 '/about': 'About the game', '/announcements': 'Announcements', '/changelog': 'Changelog',
 '/guide': 'Player guide', '/community': 'Community', '/newsletter': 'Newsletter', '/privacy': 'Privacy policy', '/monetization': 'Monetization policy', '/contact': 'Contact'
};
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
 const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function link(text: string, href: string) { const node = el('a', text); node.href = href; return node; }
function button(text: string, action: () => void, className = '') {
 const node = el('button', text, className); node.type = 'button'; node.addEventListener('click', action); return node;
}
function section(id: string, title: string, className = '') {
 const node = el('section', '', className); node.id = id; const heading = el('h2', title); heading.id = `${id}-title`; node.setAttribute('aria-labelledby', heading.id); node.append(heading); return node;
}
function field(title: string, name: string, type: string, autocomplete: HTMLInputElement['autocomplete']) {
 const label = el('label', title), input = el('input'); input.name = name; input.type = type; input.required = true; input.autocomplete = autocomplete; input.id = `access-${name}`; label.htmlFor = input.id; label.append(input); return { label, input };
}

/** Decorative twenty-sided die with colored facets and gold edges. */
function die() {
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('viewBox','0 0 64 68');svg.setAttribute('class','tabletop-die');svg.setAttribute('aria-hidden','true');
 for(const [shape,color] of [
  ['M32 3 59 18 59 49 32 65 5 49 5 18Z','#64314b'],
  ['M32 3 18 24 46 24Z','#bd6974'],['M5 18 18 24 12 47 5 49Z','#864558'],
  ['M59 18 46 24 52 47 59 49Z','#482b48'],['M18 24 46 24 32 56Z','#963f59'],
  ['M12 47 32 56 32 65 5 49Z','#76364e'],['M52 47 32 56 32 65 59 49Z','#512841']
 ]){const facet=document.createElementNS(svg.namespaceURI,'path');facet.setAttribute('d',shape!);facet.setAttribute('fill',color!);facet.setAttribute('stroke','none');svg.append(facet);}
 const lines=document.createElementNS(svg.namespaceURI,'path');
 lines.setAttribute('d','M32 3 59 18 59 49 32 65 5 49 5 18Z M32 3 18 24 46 24Z M18 24 5 18 M46 24 59 18 M18 24 12 47 32 56 52 47 46 24 M18 24 32 56 46 24 M5 49 12 47 M59 49 52 47 M32 56 32 65');
 svg.append(lines);const number=document.createElementNS(svg.namespaceURI,'text');number.setAttribute('x','32');number.setAttribute('y','39');number.textContent='20';svg.append(number);return svg;
}

/** Small decorative manuscript icons; labels remain plain text. */
function motif(kind: 'key' | 'quill' | 'compass') {
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 32 32');svg.setAttribute('class',`manuscript-icon ${kind}`);svg.setAttribute('aria-hidden','true');
 const path=document.createElementNS(svg.namespaceURI,'path');
 const shapes={key:'M13 14a6 6 0 1 0-8-8 6 6 0 0 0 8 8Zm-5-6h.01M13 13l14 14m-5-5 4-4m-8 0 4-4',quill:'M5 27 16 16M9 23C5 10 19 3 28 4c0 9-7 23-19 19Zm5-5 8-8M17 13l6 1M13 18l1 6',compass:'M16 3a13 13 0 1 0 0 26 13 13 0 0 0 0-26Zm6 7-4 8-8 4 4-8 8-4ZM16 3v3m0 20v3M3 16h3m20 0h3'};
 path.setAttribute('d',shapes[kind]);svg.append(path);return svg;
}
/** Compact public entry screen. Account secrets are submitted only through GameSession. */
export function renderLanding(session: GameSession): HTMLElement {
 const main = el('main', '', 'welcome'); main.id = 'main';
 const header = el('header', '', 'welcome-header');
 const art = el('img'); art.src='/assets/realms-tavern.webp'; art.alt=''; art.width=1600; art.height=533; art.fetchPriority='high';
 const brand = link('', '/'); brand.className='welcome-brand';
 brand.append(el('span','Adventure awaits at your table','brand-kicker'),el('span', 'REALMS', 'wordmark'), el('span', 'A world worth wandering.', 'tagline'));
 header.append(art, brand, el('span','In development · Tavern concept art','banner-note')); main.append(header);
 const footer = el('footer', '', 'welcome-footer');
 const links = el('nav'); links.setAttribute('aria-label','Information');
 links.append(link('About','/about'),link('Community','/community'),link('Newsletter','/newsletter'),link('Privacy policy','/privacy'),link('Monetization policy','/monetization'),link('Contact','/contact'));
 for(const item of links.querySelectorAll('a'))if(item.getAttribute('href')===location.pathname)item.setAttribute('aria-current','page');
 const signature=el('span','REALMS · A journey in the making.','footer-signature');signature.prepend(motif('compass'));footer.append(signature,links);
 const pageTitle = pages[location.pathname];
 if (pageTitle) {
  document.title = `${pageTitle} · Realms`;
  const page = el('section','','public-page');
  const title = el('h1', pageTitle); title.tabIndex=-1;
  page.append(el('span','From the Realms','eyebrow'), title, el('p','This page is being prepared. We’ll expand this section in an upcoming pass.'), link('← Back to the homepage','/'));
  main.append(page,footer); return main;
 }
 document.title = 'Realms · A world worth wandering';
 const changeTab = (tab: AccessTab) => {
  activeTab = tab; const next = renderLanding(session); main.replaceWith(next);
  next.querySelector<HTMLElement>(tab === 'recovery' ? '#recovery-title' : `#access-tab-${tab}`)?.focus();
 };
 const intro = el('div','','welcome-intro');
 const title = el('h1','Your next adventure starts here.'); title.tabIndex=-1;
 const ornament=el('span','','intro-ornament');ornament.setAttribute('aria-hidden','true');ornament.append(motif('compass'));
 intro.append(ornament, title, el('p','Choose a calling. Make your next move. Return to a world that remembers your journey.'));
 main.append(intro);
 const layout=el('div','','welcome-grid'), rail=el('div','','welcome-rail');
 const access = section('access', activeTab === 'recovery' ? 'Account recovery' : activeTab === 'signup' ? 'Join the adventure' : 'Log in to Realms', 'panel welcome-access');
 access.querySelector('h2')!.prepend(motif('key'));
 const tabs = el('div', '', 'access-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Account access');
 const choices: [AccessTab, string][] = [['login', 'Log in'], ['signup', 'Sign up']];
 for (const [key, text] of choices) {
  const tab = button(text, () => changeTab(key)); tab.id = `access-tab-${key}`; tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-selected', String(activeTab === key)); tab.setAttribute('aria-controls', 'access-content'); tab.tabIndex = activeTab === key ? 0 : -1;
  tab.addEventListener('keydown', event => {
   const index = choices.findIndex(([value]) => value === key); let next = index;
   if (event.key === 'ArrowRight') next = (index + 1) % choices.length;
   else if (event.key === 'ArrowLeft') next = (index + choices.length - 1) % choices.length;
   else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = choices.length - 1; else return;
   event.preventDefault(); changeTab(choices[next]![0]);
  }); tabs.append(tab);
 }
 const content = el('div', '', 'access-content'); content.id = 'access-content'; content.setAttribute('role', activeTab === 'recovery' ? 'region' : 'tabpanel'); content.setAttribute('aria-labelledby', activeTab === 'recovery' ? 'recovery-title' : `access-tab-${activeTab}`); content.tabIndex = 0;
 if (activeTab === 'signup') {
  content.append(el('h3', 'Make your first character'), el('p', 'Your account is the home for your adventures. Once you log in, choose your starting class and attributes to create your character.'),
   el('p', 'Public account signup is not open yet. This development build supports accounts enrolled by the game administrator.', 'availability'),
   button('I have an account →', () => changeTab('login'), 'primary'));
 } else if (activeTab === 'recovery') {
  const recoveryTitle=el('h3','Forgot your password?'); recoveryTitle.id='recovery-title'; recoveryTitle.tabIndex=-1;
  content.append(recoveryTitle, el('p', 'Forgot your password? Automated password reset emails are not available in this build. Contact the administrator who enrolled your account for help.'),
   el('p', 'Never share your password or access key when asking for help.', 'help muted'), button('Back to log in', () => changeTab('login'), 'primary'));
 } else if (session.config) {

  const form = el('form'); form.setAttribute('aria-label', 'Log in to Realms');
  const fields = session.config.authMode === 'sessions' ? [field('Account name', 'handle', 'text', 'username'), field('Password', 'password', 'password', 'current-password')] : [field('Development access key', 'token', 'password', 'off')];
  for (const item of fields) { item.input.disabled = session.busy; form.append(item.label); }
  const secret=fields.find(f=>f.input.type==='password');if(secret){const secretLabel=session.config.authMode==='sessions'?'password':'access key';const toggle=button(`Show ${secretLabel}`,()=>{const visible=secret.input.type==='password';secret.input.type=visible?'text':'password';toggle.textContent=`${visible?'Hide':'Show'} ${secretLabel}`;toggle.setAttribute('aria-pressed',String(visible));},'password-toggle');toggle.setAttribute('aria-controls',secret.input.id);toggle.setAttribute('aria-pressed','false');toggle.disabled=session.busy;form.append(toggle);}
  const submit = el('button', session.busy ? 'Connecting…' : 'Enter Realms →', 'primary'); submit.type = 'submit'; submit.disabled = session.busy||!!session.config.previewOnly;
  form.append(submit); form.addEventListener('submit', event => {
   event.preventDefault(); if(session.config?.previewOnly)return; const credentials = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
   for (const item of fields) if (item.input.name === 'password'||item.input.name==='token') item.input.value = '';
   void session.connect(credentials);
  }); content.append(form);
  if(session.config.previewOnly)content.append(el('p','Visual preview · Account login needs the game server.','preview-note'));
  if (session.config.authMode === 'sessions') content.append(button('Forgot your password?', () => changeTab('recovery'), 'link'));
  else content.append(el('p', 'Use the private key from your local server setup. Public account access will arrive in a future update.', 'help muted'));
 } else {
  content.append(el('h3', 'Connecting to Realms'), el('p', 'Account access needs a connection to the game server. You can still explore the updates below.'), button('Try connecting again', () => void session.initialize(), 'primary'));
 }
 if(activeTab !== 'recovery')access.append(tabs); access.append(content); rail.append(access);


 const newsletter = section('newsletter','Letters from the Realms','compact-panel newsletter');
 newsletter.querySelector('h2')!.prepend(motif('quill'));
 newsletter.append(el('p','Game news, new adventures, and development updates.'),el('span','Subscriptions coming soon','status-note'),link('Newsletter details →','/newsletter'));rail.append(newsletter);
 const updates=el('div','','welcome-updates');
 const news = section('announcements','Announcements','compact-panel news');
 news.prepend(die());
 for (const [label,title,text] of [
  ['Development','The road is taking shape.','Characters, tactical encounters, equipment, and saved progress form the foundations of your journey.'],
  ['Account access','Getting your first character','Use an account enrolled by the game administrator. Choose your starting class and attributes after logging in. Public signup is coming later.']
 ]) { const article=el('article');article.append(el('span',label!,'eyebrow'),el('h3',title!),el('p',text!));news.append(article); }
 const archives=el('nav','','announcement-links');archives.setAttribute('aria-label','Announcement archives');
 archives.append(link('All announcements','/announcements'),el('span','·','archive-divider'),link('Changelog','/changelog'));archives.querySelector('.archive-divider')!.setAttribute('aria-hidden','true');updates.append(news,archives);
 layout.append(rail,updates);main.append(layout,footer);return main;
}
