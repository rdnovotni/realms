/** Offline theme contract checks; no browser, network, or dependencies required. */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const files=['client/folio.css','client/styles.css','client/welcome.css','client/shell.css','client/character-folio.css'];
const sources=files.map(p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const theme=sources[0],root=theme.slice(theme.indexOf(':root {'),theme.indexOf(':root[data-folio-texture'));
const tokens=new Map([...root.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m=>[m[1],m[2].trim()]));
for(const [i,raw] of sources.entries()){
 const text=raw.replace(/\/\*[\s\S]*?\*\//g,'');let depth=0;
 // Quoted strings have no structural braces; strip them before balancing.
 for(const c of text.replace(/(['"])(?:\\.|(?!\1).)*?\1/g,'')){if(c==='{')depth++;if(c==='}')depth--;assert.ok(depth>=0,files[i]+': unmatched closing brace');}assert.equal(depth,0,files[i]+': unmatched opening brace');
 for(const m of text.matchAll(/var\((--[\w-]+)/g))assert.ok(tokens.has(m[1]),files[i]+': undefined token '+m[1]);
 assert.doesNotMatch(text,/@import|https?:\/\/|@font-face/,files[i]+': core styles must be local and font-independent');
}
function resolve(name,seen=new Set()){
 assert.ok(!seen.has(name),'cyclic token '+name);seen.add(name);const value=tokens.get('--folio-'+name);assert.ok(value,'missing token '+name);const ref=value.match(/^var\(--folio-([\w-]+)\)$/);return ref?resolve(ref[1],seen):value;
}
function luminance(hex){assert.match(hex,/^#[\da-f]{6}$/i);const rgb=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
function contrast(a,b){const l=[luminance(resolve(a)),luminance(resolve(b))].sort((x,y)=>y-x);return (l[0]+.05)/(l[1]+.05);}
const pairs=[];
for(const surface of ['page','surface','surface-raised','surface-inset','hover','selected'])for(const text of ['text','text-secondary','text-muted','action','danger','brass-ink'])pairs.push([text,surface,4.5]);
for(const pair of [['on-dark','nav'],['on-dark-muted','nav'],['on-dark','nav-hover'],['on-dark-muted','nav-hover'],['on-action','action'],['on-action','action-hover'],['success','success-surface'],['warning','warning-surface'],['danger','danger-surface'],['disabled','disabled-surface']])pairs.push([...pair,4.5]);
for(const surface of ['surface','surface-raised','surface-inset'])pairs.push(['border-interactive',surface,3],['focus',surface,3]);
pairs.push(['focus-halo','nav',3]);
for(const [foreground,background,minimum] of pairs){const ratio=contrast(foreground,background);assert.ok(ratio>=minimum,`${foreground} / ${background}: ${ratio.toFixed(2)} < ${minimum}`);}
const minText=Math.min(...pairs.filter(p=>p[2]===4.5).map(p=>contrast(p[0],p[1])));
console.log(`Folio: ${tokens.size} tokens resolved; ${pairs.length} WCAG contrast pairs passed (minimum text ${minText.toFixed(2)}:1); CSS structure/local assets verified.`);
