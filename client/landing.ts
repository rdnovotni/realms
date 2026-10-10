import type { GameSession } from './session.js';

type AccessTab = 'login' | 'signup' | 'recovery';
let activeTab: AccessTab = 'login';
const pages: Record<string, string> = {
 '/about': 'About the game', '/announcements': 'Announcements', '/changelog': 'Changelog',
 '/guide': 'Player guide', '/newsletter': 'Newsletter', '/privacy': 'Privacy policy', '/contact': 'Contact'
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

function navigation(className: string) {
 const nav = el('nav', '', className); nav.setAttribute('aria-label', className === 'welcome-nav' ? 'Main navigation' : 'More about Realms');
 for (const [title, href] of [['Home','/'],['About the game','/about'],['Player guide','/guide'],['Announcements','/announcements'],['Changelog','/changelog']]) {
  const item = link(title!, href!); if (location.pathname === href) item.setAttribute('aria-current','page'); nav.append(item);
 }
 return nav;
}
/** Compact public entry screen. Account secrets are submitted only through GameSession. */
export function renderLanding(session: GameSession): HTMLElement {
 const main = el('main', '', 'welcome'); main.id = 'main';
 const header = el('header', '', 'welcome-header');
 const art = el('img'); art.src='/assets/realms-dawn.webp'; art.alt=''; art.width=1280; art.height=853;
 const brand = link('', '/'); brand.className='welcome-brand';
 brand.append(el('span', 'REALMS', 'wordmark'), el('span', 'A world worth wandering.', 'tagline'));
 header.append(art, brand, el('span','Browser RPG · In development','banner-note')); main.append(header, navigation('welcome-nav'));
 const footer = el('footer', '', 'welcome-footer');
 const links = el('nav'); links.setAttribute('aria-label','Information');
 links.append(link('Newsletter','/newsletter'), link('Privacy policy','/privacy'), link('Contact','/contact'));
 footer.append(el('span','REALMS · A journey in the making.'), links);
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
  next.querySelector<HTMLElement>(`#access-tab-${tab}`)?.focus();
 };
 const intro = el('div','','welcome-intro');
 const title = el('h1','Your next adventure starts here.'); title.tabIndex=-1;
 intro.append(title, el('p','Choose a calling. Make your next move. Return to a world that remembers your journey.'));
 main.append(intro);
 const layout=el('div','','welcome-grid'), rail=el('div','','welcome-rail');
 const access = section('access', 'Log in to Realms', 'panel welcome-access');
 const tabs = el('div', '', 'access-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Account access');
 const choices: [AccessTab, string][] = [['login', 'Log in'], ['signup', 'Sign up'], ['recovery', 'Password help']];
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
 const content = el('div', '', 'access-content'); content.id = 'access-content'; content.setAttribute('role', 'tabpanel'); content.setAttribute('aria-labelledby', `access-tab-${activeTab}`); content.tabIndex = 0;
 if (activeTab === 'signup') {
  content.append(el('h3', 'Make your first character'), el('p', 'Your account is the home for your adventures. Once you log in, choose your starting class and attributes to create your character.'),
   el('p', 'Public account signup is not open yet. This development build supports accounts enrolled by the game administrator.', 'availability'),
   button('I have an account →', () => changeTab('login'), 'primary'));
 } else if (activeTab === 'recovery') {
  content.append(el('h3', 'Find your way back'), el('p', 'Forgot your password? Automated password reset emails are not available in this build. Contact the administrator who enrolled your account for help.'),
   el('p', 'Never share your password or access key when asking for help.', 'help muted'), button('Back to log in', () => changeTab('login'), 'primary'));
 } else if (session.config) {

  const form = el('form'); form.setAttribute('aria-label', 'Log in to Realms');
  const fields = session.config.authMode === 'sessions' ? [field('Account name', 'handle', 'text', 'username'), field('Password', 'password', 'password', 'current-password')] : [field('Development access key', 'token', 'password', 'off')];
  for (const item of fields) { item.input.disabled = session.busy; form.append(item.label); }
  const secret=fields.find(f=>f.input.type==='password');if(secret){const toggle=button('Show password',()=>{const visible=secret.input.type==='password';secret.input.type=visible?'text':'password';toggle.textContent=visible?'Hide password':'Show password';toggle.setAttribute('aria-pressed',String(visible));},'password-toggle');toggle.setAttribute('aria-controls',secret.input.id);toggle.setAttribute('aria-pressed','false');toggle.disabled=session.busy;form.append(toggle);}
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
 access.append(tabs, content); rail.append(access);


 const newsletter = section('newsletter','Letters from the Realms','compact-panel newsletter');
 newsletter.append(el('p','Game news, new adventures, and development updates.'),el('span','Subscriptions coming soon','status-note'),link('Newsletter details →','/newsletter'));rail.append(newsletter);
 const news = section('announcements','News from the Realms','compact-panel news');
 news.prepend(el('span','At the campfire','eyebrow'));
 for (const [label,title,text] of [
  ['Development','The road is taking shape.','Characters, tactical encounters, equipment, and saved progress form the foundations of your journey.'],
  ['Account access','Getting your first character','Use an account enrolled by the game administrator. Choose your starting class and attributes after logging in. Public signup is coming later.']
 ]) { const article=el('article');article.append(el('span',label!,'eyebrow'),el('h3',title!),el('p',text!));news.append(article); }
 news.append(link('All announcements →','/announcements'));
 const changes=el('div','','recent-changes');changes.append(el('h3','Recent development'),el('p','Character progression · Tactical combat · Equipment & loadouts'),link('View the changelog →','/changelog'));news.append(changes);
 layout.append(rail,news);main.append(layout,footer);return main;
}
