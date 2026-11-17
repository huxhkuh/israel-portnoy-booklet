'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('./playwright-runtime.cjs');
const site = path.resolve(__dirname,'..');
const outputs = path.resolve(site,'..');
const checks = [];

function mockRpc({shortTimeout = false, noRpc = false}) {
  const realSetTimeout = window.setTimeout.bind(window);
  if (shortTimeout) window.setTimeout = (callback,ms,...args) => realSetTimeout(callback,ms === 50000 ? 35 : ms,...args);
  window.__leadMock = {mode:'defer',calls:[],callbacks:[]};
  if (noRpc) return;
  function runner(success,failure) {
    return {
      withSuccessHandler(callback) {return runner(callback,failure);},
      withFailureHandler(callback) {return runner(success,callback);},
      submitLead(payload) {
        const state = window.__leadMock;
        state.calls.push(JSON.parse(JSON.stringify(payload)));
        state.callbacks.push({success,failure});
        realSetTimeout(() => {
          if (state.mode === 'success') success({ok:true,saved:true,requestId:payload.requestId});
          if (state.mode === 'network') failure(new Error('Network unavailable'));
          if (state.mode === 'wrong-id') success({ok:true,saved:true,requestId:'00000000-0000-4000-8000-000000000000'});
          if (state.mode === 'unsaved') success({ok:true,saved:false,requestId:payload.requestId});
          if (state.mode === 'validation') success({ok:false,code:'VALIDATION',fieldErrors:{phone:'יש לבדוק את מספר הטלפון.'}});
          if (state.mode === 'empty') success(undefined);
        },0);
      }
    };
  }
  window.google = {script:{run:runner()}};
}

(async () => {
  const template = await fs.readFile(path.join(site,'integrations/google-apps-script/Form.html'),'utf8');
  let siteOrigin, formOrigin;
  function renderForm() {
    const config = {siteUrl:siteOrigin+'/',siteOrigin,fontUrl:siteOrigin+'/assets/fonts/body.woff2',source:'contact',services:['ניהול נכס','ייעוץ','ליווי','שאלה אחרת'],limits:{fullName:80,phone:30,email:254,message:2000},minFillMs:0,renderedAt:Date.now()-1500};
    return template.replace('<?!= publicConfigJson ?>',JSON.stringify(config));
  }
  const formServer = http.createServer(async (request,response) => {
    if (request.url === '/outer') {
      response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      response.end('<!doctype html><iframe id="inner" src="/form" style="width:100%;height:1300px;border:0"></iframe>');return;
    }
    response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    response.end(renderForm());
  });
  const siteServer = http.createServer(async (request,response) => {
    if (request.url === '/sibling') {response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><title>Sibling test frame</title>');return;}
    if (request.url.startsWith('/assets/fonts/')) {
      const file = request.url.includes('bodybold') ? 'bodybold.woff2' : 'body.woff2';
      response.writeHead(200,{'Content-Type':'font/woff2','Access-Control-Allow-Origin':'*'});
      response.end(await fs.readFile(path.join(site,'assets/fonts',file)));return;
    }
    response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    response.end(`<!doctype html><script>window.__hello=null;addEventListener('message',event=>{if(event.data?.type==='israel-leads:hello'){window.__hello=event.data;window.__helloSource=event.source;}});</script><iframe id="sibling" src="/sibling" hidden></iframe><iframe id="outer" src="${formOrigin}/outer" style="width:100%;height:1400px;border:0"></iframe>`);
  });
  await new Promise(resolve=>siteServer.listen(0,'127.0.0.1',resolve));
  siteOrigin = `http://127.0.0.1:${siteServer.address().port}`;
  await new Promise(resolve=>formServer.listen(0,'127.0.0.1',resolve));
  formOrigin = `http://127.0.0.1:${formServer.address().port}`;
  const browser = await chromium.launch({headless:true});
  const pages = [];
  async function page(options = {}) {
    const created = await browser.newPage({viewport:{width:options.width || 390,height:1200},reducedMotion:'reduce'});
    pages.push(created);const errors=[];created.on('pageerror',error=>errors.push(error.message));
    await created.addInitScript(mockRpc,options);
    await created.goto(formOrigin+'/form');
    if (!options.noRpc) await created.locator('#lead-submit').waitFor({state:'visible'});
    return {page:created,errors};
  }
  async function fill(target) {
    await target.locator('[name=fullName]').fill('בדיקה אוטומטית');
    await target.locator('[name=phone]').fill('050-1234567');
    await target.locator('[name=service]').selectOption('ניהול נכס');
    await target.locator('[name=consent]').check();
  }
  async function waitError(target) {await target.locator('#lead-status[data-state=error]').waitFor();}
  async function calls(target) {return target.evaluate(()=>window.__leadMock.calls);}
  try {
    const normal = await page();
    await normal.page.locator('#lead-submit').click();
    assert.equal((await calls(normal.page)).length,0);
    assert.equal(await normal.page.locator('[name=fullName]').getAttribute('aria-invalid'),'true');
    assert.equal(await normal.page.locator('[name=phone]').getAttribute('aria-invalid'),'true');
    assert.equal(await normal.page.locator('[name=service]').getAttribute('aria-invalid'),'true');
    assert.equal(await normal.page.locator('[name=consent]').getAttribute('aria-invalid'),'true');
    await fill(normal.page);
    for (const email of ['not-an-email','a,b@example.com','a@exa,mple.com','a@example..com','a..b@example.com']) {
      await normal.page.locator('[name=email]').fill(email);await normal.page.locator('#lead-submit').click();assert.equal((await calls(normal.page)).length,0);
    }
    assert.equal(await normal.page.locator('[name=email]').getAttribute('aria-invalid'),'true');
    await normal.page.locator('[name=email]').fill('');
    await normal.page.evaluate(()=>{const form=document.getElementById('lead-form');form.dispatchEvent(new Event('submit',{cancelable:true}));form.dispatchEvent(new Event('submit',{cancelable:true}));});
    assert.equal((await calls(normal.page)).length,1);
    assert.equal(await normal.page.locator('#lead-submit').isDisabled(),true);
    assert.equal(await normal.page.locator('[name=phone]').isDisabled(),true);
    const initial = (await calls(normal.page))[0];
    assert.match(initial.requestId,/^[a-f0-9-]{36}$/);
    assert.equal(initial.email,'');assert.equal(initial.source,'contact');assert.equal(initial.consent,true);
    await normal.page.evaluate(()=>{const state=window.__leadMock;state.callbacks[0].success({ok:true,saved:true,requestId:state.calls[0].requestId});});
    await normal.page.locator('#lead-status[data-state=success]').waitFor();
    assert.equal(await normal.page.locator('[name=fullName]').inputValue(),'');
    checks.push('Client validates required data/optional email, prevents duplicate in-flight submissions, and clears only after a matching saved acknowledgement.');
    assert.deepEqual(normal.errors,[]);

    for (const mode of ['network','wrong-id','unsaved','empty']) {
      const instance = await page();await fill(instance.page);await instance.page.evaluate(mode=>{window.__leadMock.mode=mode;},mode);
      await instance.page.locator('#lead-submit').click();await waitError(instance.page);
      assert.equal(await instance.page.locator('[name=fullName]').inputValue(),'בדיקה אוטומטית');
      assert.equal(await instance.page.locator('#lead-status[data-state=success]').count(),0);
      const first = (await calls(instance.page))[0].requestId;
      await instance.page.evaluate(()=>{window.__leadMock.mode='success';});await instance.page.locator('#lead-submit').click();
      await instance.page.locator('#lead-status[data-state=success]').waitFor();
      assert.equal((await calls(instance.page))[1].requestId,first);
      assert.deepEqual(instance.errors,[]);
    }
    checks.push('RPC failure, wrong request ID, saved:false and empty responses never show success; retry preserves the request ID.');

    const timeout = await page({shortTimeout:true});await fill(timeout.page);await timeout.page.locator('#lead-submit').click();await waitError(timeout.page);
    const timedId = (await calls(timeout.page))[0].requestId;
    await timeout.page.evaluate(()=>{const state=window.__leadMock;state.callbacks[0].success({ok:true,saved:true,requestId:state.calls[0].requestId});});
    assert.equal(await timeout.page.locator('#lead-status[data-state=success]').count(),0);
    await timeout.page.evaluate(()=>{window.__leadMock.mode='success';});await timeout.page.locator('#lead-submit').click();await timeout.page.locator('#lead-status[data-state=success]').waitFor();
    assert.equal((await calls(timeout.page))[1].requestId,timedId);
    checks.push('An uncertain timeout keeps the draft and request ID; late callbacks are ignored and a confirmed retry succeeds.');

    const validation = await page();await fill(validation.page);await validation.page.evaluate(()=>{window.__leadMock.mode='validation';});
    await validation.page.locator('#lead-submit').click();await waitError(validation.page);
    assert.equal(await validation.page.locator('[name=phone]').getAttribute('aria-invalid'),'true');
    assert.equal(await validation.page.locator('[name=phone]').evaluate(element=>element===document.activeElement),true);
    checks.push('Server field validation is shown inline and focuses the affected field.');

    const wrongClock = await page();await fill(wrongClock.page);
    const serverTimestamp = await wrongClock.page.evaluate(()=>config.renderedAt);
    await wrongClock.page.evaluate(()=>{const now=Date.now;Date.now=()=>now()+25*60*60*1000;});
    await wrongClock.page.locator('#lead-submit').click();
    assert.equal((await calls(wrongClock.page))[0].startedAt,serverTimestamp);
    checks.push('The payload uses the server-rendered timestamp even when the device clock is wrong.');

    const honeypot = await page();await fill(honeypot.page);await honeypot.page.locator('[name=website]').evaluate(element=>{element.value='spam.example';});
    await honeypot.page.locator('#lead-submit').click();await waitError(honeypot.page);assert.equal((await calls(honeypot.page)).length,0);
    const unavailable = await page({noRpc:true});await unavailable.page.locator('#lead-unavailable').waitFor();
    assert.equal(await unavailable.page.locator('#lead-submit').isDisabled(),true);
    checks.push('Honeypot does not report fake success; missing RPC disables submission with direct-contact alternatives.');

    const nested = await browser.newPage({viewport:{width:1100,height:1100}});pages.push(nested);await nested.addInitScript(mockRpc,{});await nested.goto(siteOrigin);
    await nested.waitForFunction(()=>Boolean(window.__hello));
    const inner = nested.frames().find(frame=>frame.url()===formOrigin+'/form');assert.ok(inner);
    assert.equal(await inner.locator('#lead-submit').isDisabled(),true);
    const sibling = nested.frames().find(frame=>frame.url()===siteOrigin+'/sibling');assert.ok(sibling);
    await sibling.evaluate(origin=>{window.parent.__helloSource.postMessage({type:'israel-leads:authorize',nonce:window.parent.__hello.nonce},origin);},formOrigin);
    await nested.waitForTimeout(50);assert.equal(await inner.locator('#lead-submit').isDisabled(),true);
    await nested.evaluate(origin=>{window.__helloSource.postMessage({type:'israel-leads:authorize',nonce:'wrong-nonce'},origin);},formOrigin);
    await nested.waitForTimeout(50);assert.equal(await inner.locator('#lead-submit').isDisabled(),true);
    await nested.evaluate(origin=>{window.__helloSource.postMessage({type:'israel-leads:authorize',nonce:window.__hello.nonce},origin);},formOrigin);
    await inner.waitForFunction(()=>!document.querySelector('#lead-submit').disabled);
    checks.push('A nested iframe rejects a sibling source and wrong nonce, and unlocks only for the intended top-level origin with the matching nonce.');

    const wrapperContext = await browser.newContext();await wrapperContext.addInitScript(mockRpc,{});
    const wrapperUrl='https://script.google.com/macros/s/test-wrapper/exec';
    const innerUrl='https://test-form-script.googleusercontent.com/form';
    const attackerUrl='https://attacker-script.googleusercontent.com/';
    await wrapperContext.route(innerUrl,route=>route.fulfill({contentType:'text/html; charset=utf-8',body:renderForm()}));
    await wrapperContext.route(wrapperUrl,route=>route.fulfill({contentType:'text/html',body:`<!doctype html><iframe src="${innerUrl}"></iframe>`}));
    await wrapperContext.route(attackerUrl,route=>route.fulfill({contentType:'text/html',body:`<!doctype html><iframe src="${wrapperUrl}"></iframe>`}));
    const directGoogle=await wrapperContext.newPage();await directGoogle.goto(wrapperUrl);
    await directGoogle.waitForFunction(()=>document.querySelector('iframe')!==null);
    const directForm=directGoogle.frames().find(frame=>frame.url()===innerUrl);assert.ok(directForm);
    await directForm.waitForFunction(()=>!document.querySelector('#lead-submit').disabled);
    const attacker=await wrapperContext.newPage();await attacker.goto(attackerUrl);
    const attackedForm=attacker.frames().find(frame=>frame.url()===innerUrl);assert.ok(attackedForm);
    await attackedForm.locator('#lead-submit').waitFor({state:'visible'});
    assert.equal(await attackedForm.locator('#lead-submit').isDisabled(),true);
    assert.equal((await attackedForm.evaluate(()=>Array.from(location.ancestorOrigins))).length,2);
    await wrapperContext.close();
    checks.push('Only a single exact Google wrapper enables standalone mode; nesting inside another Apps Script origin stays locked.');

    const visual = await page({width:320});
    await visual.page.evaluate(()=>document.fonts.ready);
    const sizes=[];
    for (const width of [820,440,390,320]) {
      await visual.page.setViewportSize({width,height:1200});
      const metrics=await visual.page.evaluate(()=>({width:innerWidth,height:Math.ceil(document.getElementById('lead-root').getBoundingClientRect().height),overflow:document.documentElement.scrollWidth>innerWidth}));
      assert.equal(metrics.overflow,false);sizes.push(metrics);
      if (width===820 || width===320) await visual.page.screenshot({path:path.join(outputs,width===820?'leads-form-desktop.jpg':'leads-form-mobile.jpg'),type:'jpeg',quality:90,fullPage:true});
    }
    const report={passed:true,checks,sizes,limits:['The Google Apps Script RPC is mocked; this file does not establish that a real Google Sheet was written.','No physical phone or Safari test.']};
    await fs.mkdir(path.resolve(site,'../../work'),{recursive:true});
    await fs.writeFile(path.resolve(site,'../../work/leads-form-ui-verification.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  } finally {
    await browser.close();await new Promise(resolve=>siteServer.close(resolve));await new Promise(resolve=>formServer.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
