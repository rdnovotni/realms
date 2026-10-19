import test from 'node:test';
import assert from 'node:assert/strict';
import { inlineConfirmation } from '../client/interactions.js';

// Contract harness for review cancellation/one-shot commitment, not native dialog emulation.
class Control {
 className='';textContent='';type='';disabled=false;isConnected=true;dataset:Record<string,string>={};children:Control[]=[];parent:Control|null=null;
 listeners=new Map<string,((event:any)=>void)[]>();
 setAttribute(){}matches(){return false;}closest(){return null;}
 querySelector(selector:string):Control|null{return this.children.find(n=>'.'+n.className===selector)??null;}
 append(...nodes:Control[]){for(const n of nodes){n.parent=this;this.children.push(n);}}
 remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
 addEventListener(name:string,handler:(event:any)=>void){this.listeners.set(name,[...(this.listeners.get(name)??[]),handler]);}
 dispatch(name:string,event:Record<string,unknown>={}){for(const fn of this.listeners.get(name)??[])fn(event);}
 focus(){documentHarness.activeElement=this;}
}
const documentHarness={activeElement:null as Control|null,createElement:()=>new Control(),getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[]};
function withControls(run:(parent:HTMLElement,origin:Control)=>void){
 const globals=globalThis as unknown as Record<string,unknown>,beforeDocument=Object.getOwnPropertyDescriptor(globalThis,'document'),beforeElement=Object.getOwnPropertyDescriptor(globalThis,'HTMLElement');
 Object.defineProperty(globals,'document',{configurable:true,value:documentHarness});Object.defineProperty(globals,'HTMLElement',{configurable:true,value:Control});
 try{const origin=new Control();documentHarness.activeElement=origin;run(new Control() as unknown as HTMLElement,origin);}
 finally{if(beforeDocument)Object.defineProperty(globals,'document',beforeDocument);else delete globals.document;if(beforeElement)Object.defineProperty(globals,'HTMLElement',beforeElement);else delete globals.HTMLElement;}
}
test('one inline review commits at most once even when activation is repeated',()=>withControls((parent)=>{
 let count=0;const review=inlineConfirmation(parent,'Commit a permanent choice?',()=>count++),commit=review.children[2] as unknown as Control;
 commit.dispatch('click');commit.dispatch('click');commit.dispatch('click');assert.equal(count,1);assert.equal(commit.disabled,true);
}));
test('Escape cancels review, restores its opener, and never commits',()=>withControls((parent,origin)=>{
 let count=0,prevented=false,stopped=false;const review=inlineConfirmation(parent,'Release protection?',()=>count++) as unknown as Control;
 review.dispatch('keydown',{key:'Escape',preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
 assert.equal(count,0);assert.equal(review.isConnected,false);assert.equal(documentHarness.activeElement,origin);assert.equal(prevented,true);assert.equal(stopped,true);
}));
test('unavailable inline confirmations cannot commit',()=>withControls(parent=>{
 let count=0;const review=inlineConfirmation(parent,'Replace loadout?',()=>count++,{blocked:true}),commit=review.children[2] as unknown as Control;
 commit.dispatch('click');assert.equal(count,0);
}));
