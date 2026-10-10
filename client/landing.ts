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

/** Public funding commitments; payment and entitlement services are not yet live. */
function monetizationPage() {
 const page=el('article','','public-page policy-page monetization-page');
 const back=link('← Back to the homepage','/');back.className='policy-back';
 const heading=el('header','','policy-heading'),title=el('h1','Monetization policy');title.tabIndex=-1;
 heading.append(el('span','How we fund Realms','eyebrow'),title,
  el('p','Free to play. Supported by players.','policy-lead'));
 const promise=el('div','','policy-promise');promise.append(motif('compass'),el('p','The bulk of Realms will always be free, as long as we can maintain the game and cover hosting and server costs. You never need to pay to enjoy the full core experience.'));
 const principles=el('ul','','policy-principles');
 for(const [name,text] of [['Voluntary support','Contribute if you want to and can.'],['No advertisements','We will keep Realms ad-free.'],['No data selling','We will never sell your personal data.']] as const){
  const item=el('li');item.append(el('strong',name),el('span',text));principles.append(item);
 }
 const contents=el('nav','','policy-contents');contents.setAttribute('aria-label','On this page');contents.append(el('span','On this page'));
 for(const [name,id] of [['Free game','free-to-play'],['Supporter tokens','supporter-tokens'],['Prices','supporter-prices'],['Fair play','fair-play'],['Payments & refunds','payments-refunds'],['Current status','support-availability']] as const)contents.append(link(name,`#${id}`));
 page.append(back,heading,promise,principles,contents);
 const blocks: [string,string,string[]][]=[
  ['free-to-play','The free game',[
   'We want to fund Realms through voluntary donations. They help cover servers, hosting, and the work of keeping the game running. If you enjoy playing and choose to contribute, your support helps keep it available for everyone.',
   'The main campaign, core progression, and most content and systems will stay free. Free players should have a complete game to enjoy. Free play will keep receiving new adventures and interesting systems. No donation or subscription is required.',
   'We can keep that promise for as long as we can keep the game running. Hosting costs and maintenance are real, so we cannot promise the service will exist forever.'
  ]],
  ['supporter-tokens','What supporter tokens are for',[
   'When donations open, they will buy supporter tokens. You can spend those tokens on unique, optional content that helps fund Realms.',
   'We are planning rewards such as cosmetics, titles, music, unusual items or companions, and extra quests or small adventure areas. Some may introduce different ways to play. None will be needed to finish the main story, progress through the core game, or enjoy a full free experience.',
   'We also plan to let players trade tokens and eligible supporter goods for in-game Gold, so donating will not be the only way to access them. Individual items may be scarce, and reissues will be decided case by case.'
  ]],
  ['supporter-prices','A simple token price',[
   'One supporter token costs $10 USD. Each full token can be split into 10 mini supporter tokens, so one mini token represents $1 of support.',
   'You do not need to donate $10 at once. A $3 donation gives you 3 mini supporter tokens. Smaller contributions count, too.'
  ]],
  ['fair-play','Keeping support optional',[
   'Supporter items can be useful or unusual, but they cannot become required for progression, raids, or serious competition. Comparable power must be available through free play. Competitive formats may disable supporter effects or put everyone on equal terms.',
   'Basic storage, saved loadouts, and automation will stay free. We will not directly sell Gold or Turns, sell loot boxes or gacha, or let payments boost event scores or leaderboard results.',
   'Before you spend tokens, the shop will explain each reward and its restrictions. Supporter items remain subject to balance changes, and supporters follow the same player rules as everyone else.'
  ]],
  ['payments-refunds','Payments & refunds',[
   'We expect to use PayPal when donations open, to keep contributing straightforward. We may add other payment options later.',
   'Refunds will be handled case by case. Reasonable requests are welcome, and we will consider the circumstances of each request. There is no blanket no-refunds policy.',
   'We will publish the donation and refund-request process before accepting payments.'
  ]],
  ['support-availability','Before donations open',[
   'Realms is still in development. We are not accepting donations or selling tokens yet. The supporter shop, token trading, and recurring support are also not available.',
   'If we offer recurring support, it will deliver tokens. It will not unlock subscription-only gameplay or be required to play.',
   'The prices and refund approach above are our policy for launch. The reward catalog and payment process are still being prepared. Any material changes to this policy will be announced and reflected here.'
  ]]
 ];
 for(const [id,name,paragraphs] of blocks){
  const block=section(id,name,'policy-section');for(const text of paragraphs)block.append(el('p',text));
  if(id==='supporter-prices'){
   const examples=el('dl','','policy-token-examples');examples.setAttribute('aria-label','Donation examples');
   for(const [amount,reward] of [['$1','1 mini supporter token'],['$3','3 mini supporter tokens'],['$10','1 supporter token · splits into 10 minis']] as const){const example=el('div');example.append(el('dt',amount),el('dd',reward));examples.append(example);}
   block.append(examples);
  }
  page.append(block);
 }
 return page;
}
/** Privacy notice tied to the reviewed development build, with launch gaps disclosed. */
function privacyPage() {
 const page=el('article','','public-page policy-page privacy-page');
 const back=link('← Back to the homepage','/');back.className='policy-back';
 const heading=el('header','','policy-heading'),title=el('h1','Privacy policy');title.tabIndex=-1;
 const reviewed=el('p','','policy-reviewed'),date=el('time','October 10, 2026');date.dateTime='2026-10-10';reviewed.append('Last reviewed ',date);
 heading.append(el('span','Your information in Realms','eyebrow'),title,el('p','What we keep, how we use it, and your choices.','policy-lead'),reviewed);
 const promise=el('div','','policy-promise');promise.append(motif('quill'),el('p','We will not sell your personal data or fund Realms through advertisements. We use information to run the game, keep accounts secure, and help players.'));
 const status=el('aside','','privacy-status');status.setAttribute('aria-label','Development status');status.append(el('strong','Development notice'),el('p','This page describes the current build and our plans. Public signup, newsletters, and payments are closed. Realms is intended for ages 16+. Outstanding launch details are listed at the end of this notice.'));
 const blocks: [string,string,string[]][]=[
  ['privacy-scope','1. Scope & responsibility',[
   'This notice covers the Realms website, game client, and game server. The local visual preview serves public pages only: it has no account login or gameplay service and does not save credentials.',
   'The game administrator enrolls development accounts and is the current contact for those players. We will publish the responsible operator’s formal identity before public registration opens. External sites and services have their own privacy notices.'
  ]],
  ['privacy-information','2. Information we keep',[
   'We keep account-linked information to save your progress and check game actions. Identifiers and gameplay history can be personal information even when they contain no real name.',
   'The current account system does not ask for an email address, birth date, postal address, or legal name. Avoid putting sensitive personal details in account labels or support messages.'
  ]],
  ['privacy-use','3. How we use it',[
   'Account and session records let us sign you in, check permissions, and end expired or revoked access. Gameplay records save characters, resolve encounters, deliver rewards, and restore progress when you reconnect.',
   'Action and security history helps prevent duplicate rewards and investigate errors or suspected abuse. Technical request information helps diagnose connection problems and keep the game running.',
   'There is no third-party analytics integration in this client. Before adding analytics or another use of personal information, we will explain the collection and the choices available.'
  ]],
  ['privacy-browser','4. Browser storage & connection logs',[
   'The current client keeps its login token in browser memory, not cookies, local storage, or session storage. It sends the token to the game server when needed. Reloading clears it and requires you to reconnect.',
   'There are no advertising cookies or tracking pixels. Artwork, styles, and scripts load from the same server. Your browser may keep ordinary history or downloaded files under its own settings.',
   'Servers receive connection information, including an IP address. Realms uses it for login rate limits; that rate-limit table stores keyed references rather than raw addresses or handles. Enabled request logs can still contain connection details. Application request logging is disabled in the visual preview. Future hosting and proxy logs will depend on the deployment.'
  ]],
  ['privacy-sharing','5. Who can access it',[
   'Administrators can access records needed to operate the game, investigate problems, and secure accounts. The current public site has no player-profile directory or public gameplay-history feed.',
   'We will not sell personal data or share it for targeted advertising. Future hosting, email, and payment providers may process information needed for their services. We will identify those providers, processing locations, and information involved before the features open.',
   'We may disclose relevant information to meet a valid legal requirement or address fraud, abuse, or a serious security threat. Disclosures should be limited to what is needed. We will protect other players’ private information when handling a request.'
  ]],
  ['privacy-optional','6. Planned services',[
   'Newsletters: the current panel collects no email addresses. A future newsletter will be optional, with its provider, subscription records, and unsubscribe process explained at signup. Playing or donating will not subscribe you.',
   'Payments: donations are not open. PayPal is the likely provider and will handle payment information under its own notice. Realms will need transaction references, amounts, token grants, and refund or dispute records. We will disclose checkout fields and information returned to us before payments open.',
   'Community: chat, profiles, and player mail are not available on the current public screen. Before adding them, we will explain player visibility, moderation records, and privacy controls. Others may copy information you choose to publish.',
   'AI: no external AI service is connected to the current client or game server. Before enabling a feature that sends player information to a provider, we will explain what is sent, the provider’s practices, and your choices.'
  ]],
  ['privacy-security','7. Account security',[
   'The account database stores salted password verifiers, not readable passwords. Session tokens and recovery codes are stored as one-way digests. These protections do not make account records anonymous or guarantee that a service cannot be compromised.',
   'The server checks permissions, limits repeated login attempts, and keeps security history. Application logs are configured to redact authorization headers and request bodies. Secure production transport, hosting controls, and incident procedures still need to be established.',
   'Keep passwords and recovery codes private. Describe problems without sending those secrets. Report suspected account access to the administrator who enrolled you.'
  ]],
  ['privacy-retention','8. Retention & deletion',[
   'The development database retains account, gameplay, and security history. Some records are deliberately preserved to reconcile rewards and investigate past actions. There is no published retention schedule or automated account-deletion process yet.',
   'Signing out, letting a session expire, or starting a new character run does not erase account history. Clearing a browser token does not remove server records.',
   'Before public launch, we will define retention and deletion or anonymization for account data, logs, support messages, payment records, and backups. Immediate removal from every copy is not available today. Any retention needed for security, disputes, or legal obligations should have a documented reason and limit.'
  ]],
  ['privacy-requests','9. Your choices & requests',[
   'You can browse public pages without an account. Donations and future newsletter subscriptions are optional.',
   'Depending on applicable law, you may have rights to access or receive a copy of personal information, correct or delete it, restrict or object to uses, withdraw consent, or complain to a privacy authority. This notice does not limit those rights.',
   'For a development account, contact the administrator who enrolled you and explain what you want to access, correct, or remove. We may need to verify account ownership, without asking for passwords or recovery codes. Automated export and deletion tools are not available.',
   'Before public registration, we will confirm a working request channel, publish the process, and identify applicable response deadlines. The Contact page is still being prepared.'
  ]],
  ['privacy-age','10. Ages 16+ & mature content',[
   'Realms is intended for players aged 16 and over. Content is unfiltered and may include mature language and references to sex, drugs, violence, and alcohol. The game is not intended for children under 16. Public signup is closed; age verification is not implemented yet.',
   'Parents or guardians concerned about an under-16 development account should contact its administrator. We will review the account and information involved. Before signup opens, we need procedures to enforce the age rule and handle younger players’ data. Privacy protections may also apply to players aged 16 and 17.'
  ]],
  ['privacy-changes','11. Launch details & notice updates',[
   'Before public registration, we still need to confirm the responsible operator, active privacy inbox, hosting and backup locations, retention schedule, and request and age-verification procedures.',
   'We will update this notice when practices change and announce material changes through the game’s announcements. New services will need accurate privacy information before they open. The review date identifies this development notice; it does not certify that launch procedures are complete.'
  ]]
 ];
 const contents=el('nav','','policy-contents privacy-contents');contents.setAttribute('aria-label','On this page');contents.append(el('span','On this page'));
 for(const [id,name] of blocks)contents.append(link(name,`#${id}`));
 page.append(back,heading,promise,status,contents);
 for(const [id,name,paragraphs] of blocks){
  const block=section(id,name,'policy-section');for(const text of paragraphs)block.append(el('p',text));
  if(id==='privacy-information'){
   const categories=el('dl','','privacy-data');
   for(const [name,detail] of [
    ['Account records','Account and character IDs, creation dates, login handle, and account access status.'],
    ['Authentication records','Password verifiers, session and recovery-code digests, permissions, device labels, and activity and lifecycle dates. The browser uses the label “Realms browser”; no device fingerprint is generated.'],
    ['Saved gameplay','Character choices, progression, inventory, currency, encounters, action results, and game-history records linked to your account.'],
    ['Security & technical records','Sign-in and account-security events, request identifiers, rate-limit records, and operational logs that may include connection information.'],
    ['Information you send us','Messages and details you send to the administrator. The public client has no support form or ticket service.']
   ] as const){const item=el('div');item.append(el('dt',name),el('dd',detail));categories.append(item);}
   block.append(categories);
  }
  if(id==='privacy-requests'){const contact=el('aside','','privacy-contact');contact.setAttribute('aria-label','Planned privacy contact');contact.append(el('strong','Planned privacy contact'),el('span','privacy@realms.game','privacy-address'),el('p','Placeholder — this inbox is not confirmed active. Development players should contact their account administrator.'));block.append(contact);}
  if(id==='privacy-changes'){const top=link('Back to top ↑','#main');top.className='policy-top';block.append(top);}
  if(id==='privacy-optional'){const provider=el('p','','policy-related');provider.append('For the planned payment provider, see ',link('PayPal’s privacy statement','https://www.paypal.com/us/legalhub/paypal/privacy-full'),'.');block.append(provider);}
  page.append(block);
 }
 return page;
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
  if(location.pathname==='/monetization'){main.append(monetizationPage(),footer);return main;}
  if(location.pathname==='/privacy'){main.append(privacyPage(),footer);return main;}
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
