import type { GameSession } from './session.js';

type AccessTab = 'login' | 'signup' | 'recovery';
let activeTab: AccessTab = 'login';
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

/** Public welcome screen. Account secrets are submitted only through GameSession. */
export function renderLanding(session: GameSession): HTMLElement {
 const main = el('main', '', 'welcome'); main.id = 'main';
 const changeTab = (tab: AccessTab) => {
  activeTab = tab; const next = renderLanding(session); main.replaceWith(next);
  next.querySelector<HTMLElement>(`#access-tab-${tab}`)?.focus();
 };
 const nav = el('nav', '', 'welcome-nav'); nav.setAttribute('aria-label', 'Explore Realms');
 nav.append(link('The game', '#about-realms'), link('Announcements', '#announcements'), link('Changelog', '#changelog'), link('Newsletter', '#newsletter'));
 main.append(nav);

 const hero = el('div', '', 'welcome-hero');
 const intro = el('section', '', 'welcome-intro'); intro.setAttribute('aria-labelledby', 'welcome-title');
 const title = el('h1', 'A world to discover.\nA story to make your own.'); title.id = 'welcome-title'; title.tabIndex = -1;
 intro.append(el('span', 'Your next chapter begins here', 'eyebrow'), title,
  el('p', 'Find your calling, brave tactical encounters, and carry the stories of your adventures into a life shaped by your choices.', 'welcome-description'));
 const actions = el('div', '', 'welcome-actions');
 actions.append(button('Begin your journey →', () => { changeTab('signup'); document.getElementById('access')?.scrollIntoView({ block: 'nearest' }); }, 'primary'), link('Discover Realms ↓', '#about-realms'));
 intro.append(actions, el('p', 'Play in your browser · Return to your saved journey', 'help muted'));
 const landscape = el('div', '', 'realm-landscape'); landscape.setAttribute('aria-hidden', 'true');
 for (const name of ['sun', 'ridge far', 'ridge middle', 'ridge near', 'trail', 'tower']) landscape.append(el('span', '', name));
 intro.append(landscape);

 const access = section('access', 'The road awaits', 'panel welcome-access');
 const tabs = el('div', '', 'access-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Account access');
 const choices: [AccessTab, string][] = [['login', 'Log in'], ['signup', 'Get started'], ['recovery', 'Password help']];
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
  content.append(el('h3', 'Welcome back'), el('p', 'Pick up where your story left off.', 'muted'));
  const form = el('form'); form.setAttribute('aria-label', 'Log in to Realms');
  const fields = session.config.authMode === 'sessions' ? [field('Account name', 'handle', 'text', 'username'), field('Password', 'password', 'password', 'current-password')] : [field('Development access key', 'token', 'password', 'off')];
  for (const item of fields) { item.input.disabled = session.busy; form.append(item.label); }
  const submit = el('button', session.busy ? 'Connecting…' : 'Enter Realms →', 'primary'); submit.type = 'submit'; submit.disabled = session.busy;
  form.append(submit); form.addEventListener('submit', event => {
   event.preventDefault(); const credentials = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
   for (const item of fields) if (item.input.type === 'password') item.input.value = '';
   void session.connect(credentials);
  }); content.append(form);
  if (session.config.authMode === 'sessions') content.append(button('Forgot your password?', () => changeTab('recovery'), 'link'));
  else content.append(el('p', 'Use the private key from your local server setup. Public account access will arrive in a future update.', 'help muted'));
 } else {
  content.append(el('h3', 'Connecting to Realms'), el('p', 'Account access needs a connection to the game server. You can still explore the updates below.'), button('Try connecting again', () => void session.initialize(), 'primary'));
 }
 access.append(tabs, content); hero.append(intro, access); main.append(hero);

 const about = section('about-realms', 'Choose a calling. Leave your mark.', 'welcome-about');
 about.prepend(el('span', 'Inside the Realms', 'eyebrow'));
 const features = el('div', '', 'welcome-features');
 for (const [number, title, text] of [
  ['01', 'A character that grows with you', 'Choose your class and starting attributes. Earn experience through encounters and decide how your character grows.'],
  ['02', 'Every turn is a choice', 'Choose your targets, manage your resources, and work alongside companions in tactical combat.'],
  ['03', 'A journey worth returning to', 'Prepare your equipment, keep your discoveries, and reconnect to the same saved encounter.']
 ]) { const feature = el('article'); feature.append(el('span', number!, 'feature-number'), el('h3', title!), el('p', text!, 'muted')); features.append(feature); }
 about.append(features); main.append(about);

 const updates = el('div', '', 'welcome-updates');
 const announcements = section('announcements', 'From the Realms', 'panel'); announcements.prepend(el('span', 'Announcements', 'eyebrow'));
 const announcement = el('article', '', 'announcement');
 announcement.append(el('span', 'Development update', 'tag'), el('h3', 'The foundations of adventure'), el('p', 'The current build brings together character builds, tactical encounters, equipment preparation, and saved progress. Realms is still in development; public account registration is a future step.'));
 announcements.append(announcement);
 const details = el('details'); details.append(el('summary', 'What can I play today?'), el('p', 'An enrolled account can connect to its saved game. Available adventures depend on the content installed on your server. New characters choose their starting build after login.', 'help')); announcements.append(details);

 const changelog = section('changelog', 'What’s taking shape', 'panel'); changelog.prepend(el('span', 'Changelog', 'eyebrow'));
 const changes = el('ul', '', 'change-list');
 for (const [tag, title, text] of [
  ['New', 'A welcoming front door', 'Account access, game information, and development updates in one place.'],
  ['Playable', 'Characters & tactical encounters', 'Starting builds, earned levels, and combat that resumes after reconnecting.'],
  ['Playable', 'Equipment & saved loadouts', 'Prepare your worn gear and weapon sets, then save setups for later.']
 ]) { const item = el('li'); item.append(el('span', tag!, 'tag'), el('strong', title!), el('p', text!, 'help muted')); changes.append(item); }
 changelog.append(changes, el('p', 'This is a summary of the current development build.', 'help muted')); updates.append(announcements, changelog); main.append(updates);

 const newsletter = section('newsletter', 'Letters from the Realms', 'welcome-newsletter'); newsletter.prepend(el('span', 'Stay in the loop', 'eyebrow'));
 newsletter.append(el('p', 'Game updates, new adventures, development notes, and future playtest announcements.'));
 const newsletterStatus = el('div', '', 'newsletter-status'); newsletterStatus.append(el('span', 'Newsletter signup is coming soon', 'tag'), el('p', 'Email subscriptions are not open yet. Check the announcements here for updates; no email address is collected on this screen.', 'help'));
 newsletter.append(newsletterStatus); main.append(newsletter);
 return main;
}
