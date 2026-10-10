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
 const reviewed=el('p','','policy-reviewed'),date=el('time','October 10, 2026');date.dateTime='2026-10-10';reviewed.append('Development notice · Last reviewed ',date);
 heading.append(el('span','Your information in Realms','eyebrow'),title,el('p','What we keep, why we keep it, and what is still being built.','policy-lead'),reviewed);
 const promise=el('div','','policy-promise');promise.append(motif('quill'),el('p','We will not sell your personal data or fund Realms through advertisements. We use information to run the game, keep accounts secure, and help players.'));
 const status=el('aside','','privacy-status');status.setAttribute('aria-label','Development status');status.append(el('strong','This notice covers the development build'),el('p','Public signup, newsletter subscriptions, and payments are not open. Realms is intended for ages 16 and over. The operator’s formal details, active privacy inbox, hosting locations, and retention schedule still need to be finalized before public launch.'));
 const blocks: [string,string,string[]][]=[
  ['privacy-scope','1. Who this notice covers',[
   'This notice covers the Realms website and the current game client and server. Visiting the public pages is different from using an account on the game server: the local visual preview has no login or gameplay service and does not save account credentials.',
   'Development accounts are enrolled by the game administrator. If you already have one, use the administrator who enrolled it as your current contact for privacy questions. Our planned privacy address is privacy@realms.game. It is a placeholder, not a confirmed working inbox yet. The operator’s formal identity will be published before public registration opens.',
   'Other websites you choose to visit have their own privacy notices. This notice describes Realms; it does not control what an external payment provider or community service does.'
  ]],
  ['privacy-information','2. Information the current game handles',[
   'We keep information connected to your account so the server can remember your progress and check that actions are valid. Account identifiers and game records can be personal data when they are linked to a player, even if they do not contain a real name.',
   'The current account system does not require an email address, date of birth, postal address, or legal name. Public registration and email-based recovery are not implemented. Please avoid putting sensitive personal information into account labels or messages to the administrator.'
  ]],
  ['privacy-use','3. How we use it',[
   'Account and session information lets us authenticate you, enforce account permissions, and end access when a session expires or is revoked. Gameplay records let us save characters, resolve encounters, issue rewards, and restore your progress when you reconnect.',
   'Action and security history helps us prevent duplicate rewards, investigate errors and suspected abuse, and check the integrity of the game. Technical request information helps identify connection failures and keep the service available. These operational uses are separate from advertising.',
   'The current client has no third-party analytics or advertising integration. If we add optional analytics or a new use of personal information, we will explain what it collects and the choices available before introducing it.'
  ]],
  ['privacy-browser','4. Cookies, browser storage & connections',[
   'The current Realms client does not use cookies, local storage, or session storage to keep you logged in. Its login token stays in browser memory and is sent to the game server when needed. Reloading the page clears that in-memory token and requires you to reconnect.',
   'There are no advertising cookies, tracking pixels, or embedded third-party analytics in this client. The page’s artwork, styles, and scripts load from the same server as the game. Your browser may still keep ordinary browsing history or downloaded files under its own settings.',
   'A server receives connection information, including the connecting IP address, when you visit it. The game uses this for login rate limits, and enabled server logs can record request and connection details. The current visual preview has application request logging disabled. Hosting or proxy logs will depend on the eventual deployment; those providers and retention periods have not yet been selected.'
  ]],
  ['privacy-sharing','5. Access to information & sharing',[
   'Game-server administrators can access records needed to operate the service, investigate technical problems, and handle account security. Access to your saved account data is not the same as making it public to other players. The current public site has no player-profile directory or public gameplay-history feed.',
   'We will not sell personal data or share it for targeted advertising. When hosting, email, or payment services are introduced, they may process information needed to provide those services. We will identify those providers and the information involved before those features open.',
   'We may need to disclose relevant information in response to a valid legal requirement or to address fraud, abuse, or a serious security threat. Such disclosures should be limited to what the situation requires. A privacy request should not expose another player’s private information.',
   'The operating entity, server and backup locations, and any international processing arrangements are not finalized. We will publish them, along with any required safeguards, before public launch rather than promise that all data stays in a particular country.'
  ]],
  ['privacy-optional','6. Newsletters, payments & future features',[
   'Newsletter subscriptions are not available, and the current newsletter panel does not collect email addresses. If we introduce a newsletter, subscribing will be optional. We will explain the email provider, what subscription records are kept, and how to unsubscribe. Playing or donating will not automatically subscribe you.',
   'Donations and token purchases are not available. PayPal is the likely payment provider when they open. The provider will handle payment information under its own privacy notice. Realms will need transaction references, contribution amounts, token grants, and refund or dispute records to deliver and reconcile support purchases. The exact checkout fields and information returned to us will be disclosed before payments open.',
   'Community chat, public profiles, player mail, and broader social features are not part of the current public screen. Before adding them, we will explain what other players can see, what moderation records are kept, and which privacy controls are available. Information you deliberately publish in a community may be copied by others.',
   'There is no external AI service connected to this browser client or current game server. Any future AI feature that sends player information to a provider will need its own clear explanation of the data sent, provider practices, and available choices before it is enabled.'
  ]],
  ['privacy-security','7. Protecting account information',[
   'Passwords are checked using salted password verifiers; the account database does not store readable passwords. Session tokens and recovery codes are stored as digests on the server. This protects stored secrets, but it does not make all game records anonymous or guarantee that a service cannot be compromised.',
   'The server checks account access and permissions, limits repeated login attempts, and keeps security-event history. Its application logger is configured to redact authorization headers and request bodies. A production deployment still needs secure transport, hosting controls, and operational security procedures.',
   'Keep your password and recovery codes private. When asking for help, describe the issue without sending those secrets. If you suspect someone else has accessed your account, tell the administrator who enrolled it. We will confirm an active reporting contact before public signup opens.'
  ]],
  ['privacy-retention','8. Retention, backups & deletion',[
   'The development database retains account, gameplay, and security history. Some records are deliberately preserved so we can reconcile rewards, investigate abuse, and verify past actions. There is not yet a published retention schedule or an automatic account-deletion process.',
   'A session expiring, signing out, or starting a new character run does not erase your saved account history. Login-session expiry and security rate-limit expiry are access controls, not deletion deadlines. Removing a token from browser memory also does not remove server records.',
   'Before public launch, we will define how long account records, technical logs, security history, support correspondence, and payment records are retained, and how deletion or anonymization works. Backup retention and the time needed to remove data from backups must be specified too. We cannot promise immediate removal from every copy today.',
   'Some information may need to be retained for a documented security purpose, a dispute, or a legal obligation. A retention exception should have a reason and a limit; it should not become a reason to keep everything indefinitely.'
  ]],
  ['privacy-requests','9. Your choices & privacy requests',[
   'You can browse the public pages without an account. Donations and future newsletter subscriptions are optional. Signing out stops the current browser client from using its login token; it does not delete your account.',
   'Depending on the laws that apply, you may have rights to access or receive a copy of personal information, correct it, request deletion, restrict or object to certain uses, withdraw consent where it applies, or complain to a privacy authority. This notice does not take away those rights.',
   'For an existing development account, contact the administrator who enrolled you and explain what you want to access, correct, or remove. We may need to verify that the request relates to your account, without asking for your password or recovery codes. The current client has no automated export or deletion tool.',
   'The planned public privacy contact is privacy@realms.game (placeholder). Until we confirm it is active, existing development players should use their administrator. We will publish the request process and applicable response deadlines before public registration. The Contact page is still being prepared and is not a working request form.'
  ]],
  ['privacy-age','10. Children & player age rules',[
   'Realms is intended for players aged 16 and over. Its content is unfiltered and may include mature language and references to sex, drugs, violence, and alcohol. It is not intended for children under 16. Public signup is closed, and an age-verification process is not implemented in this build.',
   'If you are a parent or guardian and believe someone under 16 has a development account, contact the administrator responsible for it. We will review the account and the information involved. Before public registration opens, we still need procedures for enforcing the age rule and handling younger players’ information. A 16+ age rule does not replace privacy protections that may apply to older teenagers.'
  ]],
  ['privacy-changes','11. Updates to this notice',[
   'We will update this page when our practices change, and announce material changes through the game’s announcements. New signup, payment, newsletter, community, or AI features will need privacy information that reflects what they actually do before they are opened.',
   'The review date above identifies this development notice. It is not a declaration that public-launch privacy procedures are complete. The no-advertising and no-data-selling commitments remain part of how we intend to run Realms.'
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
    ['Authentication records','Password verifiers, session and recovery-code digests, permissions, device labels, and creation, activity, expiry, revocation, or use dates. The browser supplies the label “Realms browser”; it is not a device fingerprint.'],
    ['Saved gameplay','Character choices, progression, inventory, currency, encounters, action results, and game-history records linked to your account.'],
    ['Security & technical records','Sign-in and account-security events, request identifiers and operational logs. Login rate limits store keyed identifiers derived from the connecting address and handle, rather than those raw values in the rate-limit table. Other request logs can still contain connection information.'],
    ['Information you send us','If you contact the administrator, the message and any details you choose to include. There is no support form or ticket service in this public client.']
   ] as const){const item=el('div');item.append(el('dt',name),el('dd',detail));categories.append(item);}
   block.append(categories);
  }
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
