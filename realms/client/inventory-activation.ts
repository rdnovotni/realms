/** Delay single activation so a native double-click cannot operate on a tile
 * replaced by a first-click render. Modifier clicks only change selection. */
export function attachInventoryActivation(tile:HTMLButtonElement,inspect:()=>void,activate:()=>void,select:(toggle:boolean,range:boolean)=>void){
 let timer:ReturnType<typeof setTimeout>|undefined;
 tile.addEventListener('click',e=>{if(timer)clearTimeout(timer);if(e.ctrlKey||e.metaKey||e.shiftKey){select(e.ctrlKey||e.metaKey,e.shiftKey);return;}if(e.detail===0){inspect();return;}timer=setTimeout(()=>{if(tile.isConnected)inspect();},350);});
 tile.addEventListener('dblclick',e=>{e.preventDefault();if(timer)clearTimeout(timer);if(!e.ctrlKey&&!e.metaKey&&!e.shiftKey)activate();});
 tile.addEventListener('contextmenu',()=>{if(timer)clearTimeout(timer);});
 tile.addEventListener('dragstart',()=>{if(timer)clearTimeout(timer);});
}
