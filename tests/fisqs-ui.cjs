const assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]}));
const {readFileSync,mkdirSync}=require('node:fs');
const {createServer}=require('node:http');
const id='00000000-0000-0000-0000-000000000002';
(async()=>{
 const server=createServer((req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const file=path.split('/').pop();const type=file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html';res.writeHead(200,{'Content-Type':type});res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(8765,'127.0.0.1',resolve));server.unref();
 const launch={headless:true};
 if(process.env.CHROMIUM_HELPER_PATH){const helper=require(process.env.CHROMIUM_HELPER_PATH);launch.executablePath=process.env.CHROMIUM_PATH || await helper.executablePath();launch.args=helper.args;}
 const browser=await chromium.launch(launch);
 const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
 let role='reader',uploads=0,registers=0,failRegister=false,seenPayload;
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const products=[{id:'p1',name:'LOCTITE 271',manufacturer:'Henkel',code:'271',component:'',category:'Adesivos e vedantes'},{id:'p2',name:'Óleo hidráulico',manufacturer:'Lubrax',code:'68',component:'68',category:'Lubrificantes'}];
 const revisions=[{id:'r1',product_id:'p1',kind:'technical',version:1,original_name:'271.pdf',object_path:'import/one.pdf',revision_date:null,revision_label:'Março/2012',summary:'',sha256:'1'.repeat(64)},{id:'r2',product_id:'p1',kind:'technical',version:2,original_name:'271-v2.pdf',object_path:'import/two.pdf',revision_date:'2015-01-01',revision_label:'2',summary:'Resumo <img src=x onerror=alert(1)>',reviewed_by:id,sha256:'2'.repeat(64)}];
 await page.route('https://xuonzwvqqwbgcedidyie.supabase.co/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(path==='/auth/v1/token')return json({access_token:'fake-token',refresh_token:'refresh',expires_in:3600,user:{id}});
  if(path==='/auth/v1/logout')return json({});
  if(path==='/rest/v1/fisqs_members')return json(role==='outsider'?[]:[{role}]);
  if(path==='/rest/v1/fisqs_products')return json(products);
  if(path==='/rest/v1/fisqs_revisions')return json(revisions);
  if(path==='/rest/v1/rpc/fisqs_register'){
   registers++;seenPayload=request.postDataJSON();if(failRegister)return json({message:'Test failure'},500);
   const r=seenPayload.p_revision;revisions.push({...r,id:'r'+(revisions.length+1),product_id:seenPayload.p_product_id,version:3,reviewed_by:r.summary?id:null});return json('new-revision');
  }
  if(path.startsWith('/storage/v1/object/sign/'))return json({signedURL:'/object/sign/fisqs/import/two.pdf?token=test'});
  if(path.startsWith('/storage/v1/object/fisqs/')){uploads++;assert.equal(request.headers()['content-type'],'application/pdf');return json({Key:'file.pdf'});}
  if(path==='/storage/v1/object/fisqs')return json([]);
  return json({error:'Unexpected request '+path},404);
 });
 async function login(){await page.goto('http://127.0.0.1:8765/fisqs.html');await page.locator('#email').fill('test@example.com');await page.locator('#password').fill('test-only');await page.getByRole('button',{name:'Entrar',exact:true}).click();}
 await login();await page.locator('#count').filter({hasText:'2 produto'}).waitFor();
 assert.equal(await page.locator('#add').isVisible(),false);
 await page.locator('#search').fill('271');assert.equal(await page.locator('.product').count(),1);
 await page.locator('.product').click();assert.match(await page.locator('#detail-body').innerText(),/Ficha de segurança ainda não cadastrada/i);
 assert.equal(await page.locator('#detail-body img').count(),0);
 await page.getByText('Histórico de versões (1)').click();assert.equal(await page.locator('#detail-body .document').count(),2);
 await page.locator('#detail-body button[data-open="r2"]').click();await page.getByRole('link',{name:'Abrir PDF em outra aba'}).waitFor();
 assert.match(await page.getByRole('link',{name:'Abrir PDF em outra aba'}).getAttribute('href'),/storage\/v1\/object\/sign\/fisqs/);
 await page.locator('[data-close="viewer"]').click();await page.locator('[data-close="detail"]').click();
 await page.locator('#search').fill('oleo');assert.equal(await page.locator('.product').count(),1);
 await page.locator('#search').fill('nothingfound');assert.match(await page.locator('#results').innerText(),/Nenhum produto encontrado/);
 await page.locator('#search').fill('');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 mkdirSync('/tmp/vicaf-fisqs-review',{recursive:true});await page.screenshot({path:'/tmp/vicaf-fisqs-review/mobile.png',fullPage:true});
 await page.locator('#logout').click();assert.equal(await page.locator('#catalog').isVisible(),false);assert.equal(await page.locator('#results').innerText(),'');
 console.log('PASS reader login, accent-insensitive search, details, history, XSS-safe text, signed PDF, mobile layout and logout');
 role='outsider';await login();await page.getByText('Sua conta ainda não foi liberada', {exact:false}).waitFor();assert.equal(await page.locator('#catalog').isVisible(),false);
 console.log('PASS unapproved account blocked');
 role='supervisor';await login();await page.locator('#add').waitFor();await page.locator('#add').click();
 await page.locator('#product-choice').selectOption('p1');
 await page.locator('[name="kind"]').selectOption('technical');
 await page.locator('[name="pdf"]').setInputFiles({name:'invalid.pdf',mimeType:'application/pdf',buffer:Buffer.from('not a pdf')});
 await page.locator('#save').click();await page.getByText('O arquivo selecionado não é um PDF válido.').waitFor();assert.equal(uploads,0);
 await page.locator('[name="pdf"]').setInputFiles({name:'new.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\ntest PDF fixture')});
 await page.locator('[name="summary"]').fill('Conferido');await page.locator('#save').click();await page.getByText('Confirme que conferiu o resumo', {exact:false}).waitFor();assert.equal(uploads,0);
 await page.locator('[name="reviewed"]').check();await page.locator('[name="revision_date"]').fill('2014-01-01');await page.locator('#save').click();await page.getByText('Esta revisão é anterior',{exact:false}).waitFor();assert.equal(uploads,0);
 await page.locator('[name="revision_date"]').fill('2026-10-20');await page.locator('#save').click();await page.getByText('Documento salvo.',{exact:false}).waitFor();
 assert.equal(uploads,1);assert.equal(registers,1);assert.equal(seenPayload.p_product_id,'p1');assert.equal(seenPayload.p_revision.summary,'Conferido');assert.equal(seenPayload.p_revision.sha256.length,64);
 await page.locator('.product').filter({hasText:'LOCTITE'}).click();assert.match(await page.locator('#detail-body').innerText(),/versão 3/);assert.match(await page.locator('#detail-body').innerText(),/Histórico de versões \(2\)/);
 await page.locator('[data-close="detail"]').click();
 console.log('PASS supervisor PDF validation, reviewed summary, older date guard, upload, atomic registration and revision history');
 await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'/tmp/vicaf-fisqs-review/desktop.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 failRegister=true;await page.locator('#add').click();await page.locator('#product-choice').selectOption('p1');await page.locator('[name="pdf"]').setInputFiles({name:'fail.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nother')});await page.locator('#save').click();await page.getByText('Atualize o catálogo antes de tentar novamente',{exact:false}).waitFor();assert.equal(await page.locator('#editor').isVisible(),true);assert.equal(await page.locator('#save').isEnabled(),true);
 console.log('PASS registration failure preserves form and reports uncertain outcome');
 assert.deepEqual(errors,[]);await browser.close();server.close();
})().catch(e=>{console.error(e);process.exit(1)});
