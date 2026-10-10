import type { GameSession } from './session.js';

type AccessTab = 'login' | 'signup' | 'recovery';
let activeTab: AccessTab = 'login';
type Guide = 'character' | 'combat' | 'equipment';
let activeGuide: Guide = 'character';
type UpdateFilter = 'All updates' | 'Gameplay' | 'Interface';
let updateFilter: UpdateFilter = 'All updates';
const updates = [
 {category:'Interface',title:'A new front door to the Realms',text:'An illustrated welcome, account access, and a field guide to your first journey.',kind:'New'},
 {category:'Gameplay',title:'Your next move matters',text:'Choose targets, spend actions and resources, and resume saved tactical encounters.',kind:'Playable'},
 {category:'Gameplay',title:'Prepare for the road ahead',text:'Equip carried gear, prepare weapon sets, and save your committed loadouts.',kind:'Playable'},
 {category:'Gameplay',title:'Build a character through your choices',text:'Choose starting attributes and a class, then spend earned levels on growth.',kind:'Playable'}
];
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
function icon(kind: 'compass' | 'sword' | 'pack' | 'mail' | 'spark') {
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('aria-hidden','true'); svg.setAttribute('class','welcome-icon');
 const path=document.createElementNS('http://www.w3.org/2000/svg','path');
 const paths={compass:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4 6-2 6-6 2 2-6 6-2Z',sword:'m4 20 4-4m-3-3 6 6m-4-6 10-10h4v4L11 17',pack:'M8 7V5a4 4 0 0 1 8 0v2M6 7h12l2 14H4L6 7Zm2 6h8v5H8v-5Z',mail:'M3 5h18v14H3V5Zm0 1 9 7 9-7',spark:'m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z'};
 path.setAttribute('d',paths[kind]); svg.append(path); return svg;
}

function renderFieldGuide() {
 const guide=section('field-guide','The choices that make a life.','field-guide welcome-section');
 guide.prepend(el('span','The field guide','eyebrow'));
 guide.append(el('p','A little preparation. A thoughtful turn. A character that becomes your own.','section-intro'));
 const layout=el('div','','guide-layout'),nav=el('div','','guide-nav'),display=el('div','','guide-display');
 nav.setAttribute('aria-label','Game systems'); display.id='guide-display'; display.setAttribute('role','region'); display.setAttribute('aria-live','polite');
 const choices:[Guide,string,string,'compass'|'sword'|'pack'][]=[['character','Find your calling','Character & progression','compass'],['combat','Make your next move','Tactical encounters','sword'],['equipment','Ready your pack','Equipment & loadouts','pack']];
 const buttons:HTMLButtonElement[]=[];
 const draw=()=>{
  for(const b of buttons)b.setAttribute('aria-pressed',String(b.dataset.guide===activeGuide));
  display.replaceChildren();
  const copy=el('div','','guide-copy'),illustration=el('div','','guide-illustration');
  illustration.setAttribute('aria-label','Illustrative game-system overview');
  if(activeGuide==='character'){
   copy.append(el('span','01 / Character','eyebrow'),el('h3','A calling is only the beginning.'),el('p','Choose your starting class and attributes. The encounters you face earn experience; the levels you gain open the next choice in your build.'),el('p','Your character’s actual options come from the game’s installed content.','help muted'));
   const seal=el('div','','calling-seal');seal.append(icon('compass'));
   illustration.append(seal,el('span','Your character','eyebrow'),el('strong','Choose. Adventure. Grow.','illustration-title'));
   const path=el('ol','','growth-path');for(const text of ['Starting build','Earned experience','Your next level'])path.append(el('li',text));illustration.append(path);
  }else if(activeGuide==='combat'){
   copy.append(el('span','02 / Encounters','eyebrow'),el('h3','Take a breath. Then take your turn.'),el('p','Consider your target, your position, and the resources you have left. Choose actions for your character and companions, then let the world answer.'),el('p','A saved encounter resumes from the same turn when you reconnect.','help muted'));
   illustration.append(el('span','A turn at a glance','eyebrow'),el('strong','Position → Action → Outcome','illustration-title'));
   const zones=el('div','','guide-zones');for(const [symbol,title] of [['◇','Your party'],['⋄','The battlefield'],['◆','Opponents']]){const zone=el('div');zone.append(el('span',symbol!),el('small',title!));zones.append(zone);}illustration.append(zones,el('p','Pick a target · Manage resources · Choose when to advance','help'));
  }else{
   copy.append(el('span','03 / Equipment','eyebrow'),el('h3','A good journey begins with a ready pack.'),el('p','Prepare your worn gear and two weapon sets before the next encounter. Save a committed setup as a loadout, so you can return to it later.'),el('p','Gear requirements and binding consequences are shown before you commit.','help muted'));
   illustration.append(icon('pack'),el('span','Before you set out','eyebrow'),el('strong','Prepared for what comes next.','illustration-title'));
   const gear=el('div','','guide-gear');for(const [title,text] of [['Worn gear','Your equipped setup'],['Weapon sets','A / B preparation'],['Loadouts','Saved arrangements']]){const row=el('div');row.append(el('strong',title!),el('small',text!));gear.append(row);}illustration.append(gear);
  }
  illustration.append(el('small','Illustrative overview · not a gameplay screenshot','illustration-caption'));display.append(copy,illustration);
 };
 for(const [key,title,subtitle,symbol]of choices){const b=button('',()=>{activeGuide=key;draw();},'guide-choice');b.dataset.guide=key;b.setAttribute('aria-controls',display.id);const text=el('span');text.append(el('strong',title),el('small',subtitle));b.append(icon(symbol),text,el('span','↗','guide-arrow'));buttons.push(b);nav.append(b);}
 draw();layout.append(nav,display);guide.append(layout);return guide;
}

function renderDevelopmentNotes(){
 const panel=section('changelog','The development ledger.','ledger');panel.prepend(el('span','Changelog','eyebrow'));
 const filters=el('div','','update-filters'),list=el('ul','','change-list');filters.setAttribute('aria-label','Filter development updates');list.setAttribute('aria-live','polite');
 const buttons:HTMLButtonElement[]=[];
 const draw=()=>{for(const b of buttons)b.setAttribute('aria-pressed',String(b.textContent===updateFilter));list.replaceChildren();for(const update of updates.filter(u=>updateFilter==='All updates'||u.category===updateFilter)){const item=el('li');const meta=el('div','','change-meta');meta.append(el('span',update.kind,'tag'),el('span',update.category,'help muted'));item.append(meta,el('h3',update.title),el('p',update.text,'help muted'));list.append(item);}};
 for(const name of ['All updates','Gameplay','Interface']as const){const b=button(name,()=>{updateFilter=name;draw();});buttons.push(b);filters.append(b);}draw();
 panel.append(filters,list,el('p','A summary of the current development build.','help muted'));return panel;
}

/** Public welcome screen. Account secrets are submitted only through GameSession. */
export function renderLanding(session: GameSession): HTMLElement {
 const main = el('main', '', 'welcome'); main.id = 'main';
 const changeTab = (tab: AccessTab) => {
  activeTab = tab; const next = renderLanding(session); main.replaceWith(next);
  next.querySelector<HTMLElement>(`#access-tab-${tab}`)?.focus();
 };
 const header=el('header','','welcome-header'),brand=link('','#main');brand.className='welcome-brand';const brandText=el('span');brandText.append(el('strong','REALMS'),el('small','A world worth wandering'));brand.append(icon('compass'),brandText);
 const nav = el('nav', '', 'welcome-nav'); nav.setAttribute('aria-label', 'Explore Realms');
 nav.append(link('The game', '#about-realms'),link('Field guide','#field-guide'), link('Updates', '#announcements'),link('FAQ','#welcome-faq'));
 const accessLink=link('Enter Realms ↗','#access');accessLink.className='header-access';header.append(brand,nav,accessLink);main.append(header);

 const hero = el('div', '', 'welcome-hero');
 const intro = el('section', '', 'welcome-intro'); intro.setAttribute('aria-labelledby', 'welcome-title');
 const title = el('h1', 'Your next life');title.append(el('em','starts here.')); title.id = 'welcome-title'; title.tabIndex = -1;
 const badge=el('span','A browser RPG in development','hero-badge');badge.prepend(icon('spark'));
 intro.append(badge, title,
  el('p', 'A calling to find. A road to follow. Step into tactical adventures and build a character shaped by the choices you make.', 'welcome-description'));
 const actions = el('div', '', 'welcome-actions');
 actions.append(button('Begin your journey', () => { changeTab('signup'); document.getElementById('access')?.scrollIntoView({ block: 'nearest' }); }, 'primary'), link('Explore the game ↓', '#about-realms'));
 intro.append(actions, el('p', 'Browser-based · Thoughtful turns · A saved journey', 'hero-footnote'));
 const landscape=el('div','','hero-art'),art=el('img');art.src='/assets/realms-dawn.webp';art.alt='';art.width=1280;art.height=853;art.fetchPriority='high';landscape.append(art);hero.append(landscape,el('span','A glimpse of the world · Concept illustration','hero-caption'));

 const access = section('access', 'Welcome, traveler.', 'panel welcome-access');access.prepend(el('span','Your story continues','eyebrow'));
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
 access.append(tabs, content,el('p','Your progress is saved by the game server.','access-footnote')); hero.append(intro, access); main.append(hero);

 const about = section('about-realms', 'Small choices. A life of adventure.', 'welcome-about welcome-section');
 about.prepend(el('span', 'Welcome to the Realms', 'eyebrow'));
 about.append(el('p','Adventure at your own pace. Find a build that feels like you, learn from each encounter, and return to a journey that remembers where you left off.','section-intro'));
 const features = el('div', '', 'welcome-features');
 for (const [number, title, text] of [
  ['01', 'A character that grows with you', 'Choose your class and starting attributes. Earn experience through encounters and decide how your character grows.'],
  ['02', 'Every turn is a choice', 'Choose your targets, manage your resources, and work alongside companions in tactical combat.'],
  ['03', 'A journey worth returning to', 'Prepare your equipment, keep your discoveries, and reconnect to the same saved encounter.']
 ]) { const feature = el('article'); feature.append(el('span', number!, 'feature-number'), el('h3', title!), el('p', text!, 'muted')); features.append(feature); }
 about.append(features); main.append(about,renderFieldGuide());

 const updatesArea = el('div', '', 'welcome-updates welcome-section');
 const announcements = section('announcements', 'From the campfire.', 'announcements'); announcements.prepend(el('span', 'News & announcements', 'eyebrow'));
 const announcement = el('article', '', 'announcement');
 const newsArt=el('div','','news-art'),newsImage=el('img');newsImage.src='/assets/realms-dawn.webp';newsImage.alt='';newsImage.loading='lazy';newsImage.width=1280;newsImage.height=853;newsArt.append(newsImage,el('span','Dispatch / 01','news-art-label'));
 announcement.append(newsArt,el('span', 'Development dispatch', 'tag'), el('h3', 'The road is taking shape.'), el('p', 'Characters, tactical encounters, equipment, and saved progress: the foundations of a journey are coming together. Our new front page is another step toward welcoming you into the Realms.'),link('Explore what’s playable ↗','#field-guide'));
 announcements.append(announcement);
 const details = el('details'); details.append(el('summary', 'What can I play today?'), el('p', 'An enrolled account can connect to its saved game. Available adventures depend on the content installed on your server. New characters choose their starting build after login.', 'help')); announcements.append(details);

 updatesArea.append(announcements,renderDevelopmentNotes());main.append(updatesArea);

 const faq=section('welcome-faq','Before you take the first step.','welcome-faq welcome-section');faq.prepend(el('span','A few things to know','eyebrow'));
 const faqList=el('div','','faq-list');
 for(const[question,answer]of[
  ['What kind of game is Realms?','Realms is a browser role-playing game built around character choices, tactical encounters, equipment, and persistent progress. The current build is a development foundation, with playable content determined by the server.'],
  ['How do I create a character?','Log in with an account enrolled by the game administrator. If your starting build has not been chosen yet, the Character screen opens so you can select a class and attributes. Public account registration is not open yet.'],
  ['Can I stop in the middle of an encounter?','Yes. Encounters and their progress are saved by the server. Log back in to resume the same fight. Actions do not continue while you are disconnected.'],
  ['Does browsing use my Turns?','Browsing your character, pack, and saved encounter costs no Turns. Adventures disclose their entry and recovery costs before you begin.'],
  ['How can I follow development?','Read the announcements and development ledger on this page. Newsletter subscriptions will be added once email delivery is ready.']
 ]){const item=el('details');item.append(el('summary',question!),el('p',answer!));faqList.append(item);}faq.append(faqList);main.append(faq);

 const newsletter = section('newsletter', 'A letter when the road goes further.', 'welcome-newsletter'); newsletter.prepend(icon('mail'),el('span', 'Letters from the Realms', 'eyebrow'));
 newsletter.append(el('p', 'Game updates, new adventures, development notes, and future playtest announcements.'));
 const newsletterStatus = el('div', '', 'newsletter-status'); newsletterStatus.append(el('span', 'Newsletter signup is coming soon', 'tag'), el('p', 'Email subscriptions are not open yet. Check the announcements here for updates; no email address is collected on this screen.', 'help'));
 newsletterStatus.append(link('Read the latest dispatch ↗','#announcements'));newsletter.append(newsletterStatus); main.append(newsletter);
 const footer=el('footer','','welcome-footer'),footerBrand=el('div');footerBrand.append(el('strong','REALMS'),el('p','A world worth wandering.','help muted'));const footerNav=el('nav');footerNav.setAttribute('aria-label','Footer');footerNav.append(link('The game','#about-realms'),link('Field guide','#field-guide'),link('Changelog','#changelog'),link('Newsletter','#newsletter'));footer.append(footerBrand,footerNav,el('small','In development. One journey at a time.'));main.append(footer);
 return main;
}
