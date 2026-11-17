const {chromium}=require('./playwright-runtime.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.SITE_TEST_URL||'http://127.0.0.1:4173/';
const endpoint='https://script.google.com/macros/s/AKfycbPUBLIC_DEPLOYMENT_TEST_1234567890/exec';
const childOrigin='https://n-test-0lu-script.googleusercontent.com';
const site=path.join(__dirname,'..');
(async()=>{
  const template=await fs.readFile(path.join(site,'integrations/google-apps-script/Form.html'),'utf8');
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base);assert.equal(await page.locator('#contact-form-shell').isVisible(),false);
    const downloads=await page.locator('a[download]').evaluateAll(elements=>elements.map(element=>element.getAttribute('href')));
    assert.ok(downloads.length>=5);assert.ok(downloads.every(href=>href.endsWith('.pdf')));
    await page.route('**/leads-config.js',route=>route.fulfill({contentType:'text/javascript',body:`window.ISRAEL_LEADS_CONFIG={webAppUrl:${JSON.stringify(endpoint)},loadTimeoutMs:5000};`}));
    await page.route(endpoint+'?*',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}</style><iframe src="${childOrigin}/form"></iframe>`}));
    const config={siteUrl:base,siteOrigin:new URL(base).origin,fontUrl:new URL('assets/fonts/body.woff2',base).href,renderedAt:Date.now()-2000,source:'contact',services:['ניהול נכס','ייעוץ','ליווי','שאלה אחרת'],limits:{fullName:80,phone:30,email:254,message:2000},minFillMs:0};
    const rpc=`window.__calls=[];window.google={script:{run:{withSuccessHandler(callback){this.success=callback;return this;},withFailureHandler(callback){this.failure=callback;return this;},submitLead(payload){window.__calls.push(payload);setTimeout(()=>this.success({ok:true,saved:true,requestId:payload.requestId}),100);}}}};`;
    await page.route(childOrigin+'/form',route=>route.fulfill({contentType:'text/html',body:template.replace('<?!= publicConfigJson ?>',JSON.stringify(config)).replace("'use strict';",`'use strict';${rpc}`)}));
    await page.route('**/assets/fonts/*.woff2',async route=>{
      const filename=path.basename(new URL(route.request().url()).pathname);
      await route.fulfill({contentType:'font/woff2',headers:{'Access-Control-Allow-Origin':'*'},body:await fs.readFile(path.join(site,'assets/fonts',filename))});
    });
    await page.goto(base+'?leads-test=1#contact');
    await page.locator('#contact-form-shell iframe').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('.contact-form-frame').classList.contains('lead-frame-ready'));
    const frame=page.frames().find(frame=>frame.url()===childOrigin+'/form');assert.ok(frame);
    assert.equal(await frame.locator('#lead-submit').isEnabled(),true);
    for(const width of [1440,820,390,320]){
      await page.setViewportSize({width,height:1000});
      await page.waitForTimeout(80);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.equal(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.ok(Number.parseInt(await page.locator('.contact-form-frame').evaluate(element=>element.style.height),10)>=350);
      await page.locator('#contact-form-shell').scrollIntoViewIfNeeded();
      if(width===1440||width===390)await page.screenshot({path:path.join(site,'..',width===1440?'leads-contact-desktop.jpg':'leads-contact-mobile.jpg'),type:'jpeg',quality:90,fullPage:false});
    }
    await frame.locator('#lead-full-name').fill('בדיקת מערכת');await frame.locator('#lead-phone').fill('0501234567');await frame.locator('#lead-service').selectOption('ייעוץ');await frame.locator('#lead-consent').check();
    await frame.locator('#lead-submit').click();await frame.waitForFunction(()=>document.querySelector('#lead-status').dataset.state==='success');
    assert.equal(await frame.evaluate(()=>window.__calls.length),1);
    assert.equal(await page.locator('#contact-form-shell').isVisible(),true);
    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(site,'../../work/leads-site-ui-verification.json'),JSON.stringify({passed:true,checks:['Unconfigured site retains existing contacts and free downloads','Nested cross-origin Google-style iframe handshake','Natural-height resize at 1440/820/390/320 without overflow','Confirmed RPC result shown only inside form','No application errors'],limits:['Google wrapper and RPC were simulated locally; no live submission or email occurred.']},null,2));
    console.log('PASS: site integration, nested cross-origin frame, mobile layout, free downloads and confirmed mock RPC.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
