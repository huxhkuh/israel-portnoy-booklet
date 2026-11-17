const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../leads.js'), 'utf8');
const endpoint = 'https://script.google.com/macros/s/AKfycbPUBLIC_DEPLOYMENT_TEST_1234567890/exec';
function harness(webAppUrl = endpoint) {
  const classes = new Set();
  const outer = {}; outer.parent = outer;
  const frame = {contentWindow: outer, hidden: false, style:{}, classList:{add(value){classes.add(value);}}};
  const status = {hidden:false,textContent:'טוענים',setAttribute(){}};
  const direct = {};
  const shell = {hidden:true,classList:{add(value){classes.add(value);},remove(value){classes.delete(value);}},
    querySelector(selector){return selector==='iframe'?frame:selector.includes('status')?status:direct;}};
  const listeners = {}; let timeout, cleared=false;
  vm.runInNewContext(code, {window:{ISRAEL_LEADS_CONFIG:{webAppUrl,loadTimeoutMs:5000}},URL,
    document:{querySelector(){return shell;}},addEventListener(type,fn){listeners[type]=fn;},
    setTimeout(fn){timeout=fn;return 1;},clearTimeout(){cleared=true;}});
  return {frame,status,direct,shell,classes,outer,
    message(data,source,origin='https://n-app-0lu-script.googleusercontent.com'){listeners.message?.({data,source,origin});},
    timeout(){timeout?.();},get cleared(){return cleared;}};
}
test('An unconfigured or invalid deployment never exposes an unusable form',()=>{
  for(const url of ['', 'https://evil.example/macros/s/AKfycbPUBLIC_DEPLOYMENT_TEST_1234567890/exec',endpoint.replace('/exec','/dev'),endpoint.replace('https:','http:')]){
    const h=harness(url);assert.equal(h.shell.hidden,true);assert.equal(h.frame.src,undefined);
  }
});
test('Valid deployment embeds only the public URL; the direct alternative has no embed flag',()=>{
  const h=harness();assert.equal(h.shell.hidden,false);
  const src=new URL(h.frame.src);assert.equal(src.searchParams.get('source'),'contact');assert.equal(src.searchParams.get('embed'),'1');
  assert.equal(new URL(h.direct.href).searchParams.has('embed'),false);
});
test('A nested Google HtmlService frame can handshake using an exact response origin',()=>{
  const h=harness();const sent=[];const inner={parent:h.outer,postMessage(data,origin){sent.push({data,origin});}};
  const nonce='0123456789abcdef0123456789abcdef';
  h.message({type:'israel-leads:hello',nonce},inner);
  assert.equal(sent.length,1);assert.equal(sent[0].data.type,'israel-leads:authorize');assert.equal(sent[0].data.nonce,nonce);
  assert.equal(sent[0].origin,'https://n-app-0lu-script.googleusercontent.com');
  h.message({type:'israel-leads:ready',nonce,height:730},inner);
  assert.equal(h.status.hidden,true);assert.equal(h.frame.style.height,'730px');assert.equal(h.cleared,true);
});
test('Foreign windows, lookalike origins and stale nonces cannot authorize or resize the frame',()=>{
  const h=harness();let calls=0;const inner={parent:h.outer,postMessage(){calls++;}};const stranger={postMessage(){calls++;}};stranger.parent=stranger;
  const nonce='0123456789abcdef0123456789abcdef';
  h.message({type:'israel-leads:hello',nonce},stranger);
  h.message({type:'israel-leads:hello',nonce},inner,'https://script.googleusercontent.com.evil.example');
  h.message({type:'israel-leads:hello',nonce},inner,'null');assert.equal(calls,0);
  h.message({type:'israel-leads:hello',nonce},inner);assert.equal(calls,1);
  h.message({type:'israel-leads:ready',nonce:'different-nonce-0000',height:9999},inner);assert.equal(h.status.hidden,false);
  h.message({type:'israel-leads:height',nonce,height:9999},inner);assert.equal(h.frame.style.height,undefined);
  h.message({type:'israel-leads:ready',nonce,height:9999},inner);assert.equal(h.frame.style.height,'1800px');
});
test('A blocked or unavailable iframe gives an honest fallback, never submission success',()=>{
  const h=harness();h.timeout();assert.equal(h.frame.hidden,true);assert.match(h.status.textContent,/הטופס לא נטען/);
  assert.ok(h.classes.has('lead-frame-unavailable'));assert.equal(h.status.hidden,false);
});
