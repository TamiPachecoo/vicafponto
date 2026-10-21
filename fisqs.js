'use strict';
(() => {
  const URL = 'https://xuonzwvqqwbgcedidyie.supabase.co';
  const KEY = 'sb_publishable_90r8S_3VdagojDIoPHe5Gg_Ief-vsnu';
  const KINDS = {safety:'Ficha de segurança', technical:'Ficha técnica', certificate:'Certificado / lote', other:'Outros'};
  const $ = id => document.getElementById(id);
  let session = null, role = null, products = [], revisions = [], saving = false, signing = 0, authGeneration = 0;
  const text = (tag, value, className) => { const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el; };
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const canWrite = () => role === 'supervisor' || role === 'admin';
  function message(id, value, error = false) { $(id).textContent = value; $(id).className = error ? 'error' : 'muted'; }
  async function raw(path, options = {}, token = session?.access_token) {
    const headers = {apikey:KEY, ...options.headers};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body && !(options.body instanceof File)) headers['Content-Type'] ||= 'application/json';
    const res = await fetch(URL + path, {...options, headers, cache:'no-store', signal:AbortSignal.timeout(30000)});
    const result = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401) throw new Error('Sessão expirada ou acesso inválido. Entre novamente.');
      if (res.status === 403) throw new Error('Sua conta não tem permissão para esta operação.');
      throw new Error(result?.message || result?.msg || result?.error_description || 'Não foi possível concluir. Tente novamente.');
    }
    return result;
  }
  async function request(path, options = {}) {
    if (!session) throw new Error('Entre para acessar os documentos.');
    if (session.expires_at < Date.now() / 1000 + 60) {
      const next = await raw('/auth/v1/token?grant_type=refresh_token', {method:'POST',body:JSON.stringify({refresh_token:session.refresh_token})}, null);
      session = {...next, expires_at:Date.now()/1000 + next.expires_in};
    }
    return raw(path, options);
  }
  async function allRows(table, order) {
    let rows = [];
    for (let offset = 0; ; offset += 500) {
      const batch = await request(`/rest/v1/${table}?select=*&order=${order}&offset=${offset}&limit=500`);
      rows.push(...batch);
      if (batch.length < 500) return rows;
    }
  }
  async function loadEmployees() {
    const rows = await raw('/rest/v1/usuario?status=eq.active&select=full_name&order=full_name.asc', {}, null);
    $('employee').replaceChildren(new Option('Selecione seu nome',''), ...rows.map(row => new Option(row.full_name, row.full_name)));
  }
  async function load() {
    const generation = authGeneration;
    message('status','Carregando documentos…'); $('retry').hidden = true;
    try {
      const data = await Promise.all([allRows('fisqs_products','name.asc,id.asc'), allRows('fisqs_revisions','created_at.desc,id.asc')]);
      if (generation !== authGeneration || !session) return;
      [products,revisions] = data;
      const selected = $('category').value;
      $('category').replaceChildren(new Option('Todas as categorias',''), ...[...new Set(products.map(p=>p.category))].sort().map(v=>new Option(v,v)));
      $('category').value = selected;
      render(); message('status','');
    } catch (e) { if(generation !== authGeneration || !session)return; message('status','Não foi possível atualizar o catálogo. ' + e.message,true); $('retry').hidden = false; }
  }
  function latest(productId) {
    const grouped = new Map();
    revisions.filter(r=>r.product_id===productId).forEach(r=>{if (!grouped.has(r.kind) || grouped.get(r.kind).version < r.version) grouped.set(r.kind,r);});
    return [...grouped.values()];
  }
  function dateLabel(value) { return value ? new Date(value+'T12:00:00').toLocaleDateString('pt-BR') : 'Data de revisão não informada'; }
  function revisionWarning(r) {
    if (!r.revision_date) return 'Revisão a conferir';
    return new Date(r.revision_date+'T12:00:00').getFullYear() < new Date().getFullYear()-3 ? 'Conferir atualização com o fabricante' : '';
  }
  function render() {
    const query = normalize($('search').value).trim().split(/\s+/);
    const visible = products.filter(p => (!$('category').value || p.category === $('category').value) && query.every(q=>normalize([p.name,p.manufacturer,p.code,p.component,p.category].join(' ')).includes(q)));
    $('count').textContent = `${visible.length} produto(s) encontrado(s)`;
    $('results').replaceChildren();
    visible.forEach(p=>{
      const card = document.createElement('button'); card.className='product'; card.dataset.product=p.id;
      card.append(text('strong',p.name),text('span',[p.manufacturer,p.code,p.component].filter(Boolean).join(' · ') || 'Identificação complementar não informada','muted'));
      const tags=text('div','','tags'); const docs=latest(p.id);
      docs.forEach(r=>tags.append(text('span',KINDS[r.kind],'tag')));
      if (!docs.some(r=>r.kind==='safety')) tags.append(text('span','Ficha de segurança não cadastrada','tag warn'));
      card.append(tags,text('span','Ver documentos e detalhes →','muted')); $('results').append(card);
    });
    if (!visible.length) $('results').append(text('p',products.length ? 'Nenhum produto encontrado. Tente outro nome ou código.' : 'Nenhum produto cadastrado. O supervisor pode adicionar o primeiro documento.','muted'));
  }
  function documentCard(r, historical=false) {
    const card=text('article','','document');
    card.append(text('h3',`${KINDS[r.kind]} · versão ${r.version}${historical?' · histórico':''}`),text('p',r.original_name,'muted'),text('p',`${dateLabel(r.revision_date)}${r.revision_label?' · '+r.revision_label:''}`,'muted'));
    const warning=revisionWarning(r); if(warning) card.append(text('span',warning,'tag warn'));
    if(r.scanned) card.append(text('p','PDF digitalizado. Consulte o original para conferir detalhes.','muted'));
    if(r.summary && r.reviewed_by) card.append(text('p',r.summary,'summary'),text('p','Resumo conferido por um supervisor no cadastro desta versão. Consulte também o documento original.','muted'));
    else card.append(text('p','Resumo ainda não cadastrado. As informações estão no documento original.','muted'));
    const actions=text('div','','actions'); const open=text('button','Abrir documento');open.dataset.open=r.id;actions.append(open);
    if(canWrite()&&!historical){const update=text('button','Adicionar revisão');update.dataset.update=r.product_id;update.dataset.kind=r.kind;actions.append(update);}
    card.append(actions);return card;
  }
  function showDetails(id) {
    const p=products.find(p=>p.id===id);if(!p)return;
    $('detail-title').textContent=p.name;
    const body=$('detail-body'); body.replaceChildren(text('p',[p.manufacturer,p.code,p.component,p.category].filter(Boolean).join(' · '),'muted'));
    const docs=latest(id);
    if(!docs.some(r=>r.kind==='safety'))body.append(text('p','Segurança: ficha de segurança ainda não cadastrada.','tag warn'));
    if(!docs.some(r=>r.kind==='technical'))body.append(text('p','Informações técnicas: ficha técnica ainda não cadastrada.','muted'));
    docs.forEach(r=>body.append(documentCard(r)));
    const history=revisions.filter(r=>r.product_id===id&&!docs.some(d=>d.id===r.id)).sort((a,b)=>b.version-a.version);
    if(history.length){const details=document.createElement('details');details.append(text('summary',`Histórico de versões (${history.length})`));history.forEach(r=>details.append(documentCard(r,true)));body.append(details);}
    if(canWrite()){const add=text('button','Adicionar documento a este produto');add.dataset.update=id;body.append(add);}
    if(!$('detail').open)$('detail').showModal();
  }
  async function view(id) {
    const revision=revisions.find(r=>r.id===id);if(!revision)return;
    const generation=++signing;
    $('viewer-links').replaceChildren();$('pdf-frame').hidden=true;$('pdf-frame').removeAttribute('src');
    $('viewer-title').textContent=revision.original_name;message('viewer-status','Abrindo documento…');$('viewer').showModal();
    try{
      const result=await request('/storage/v1/object/sign/fisqs/'+revision.object_path.split('/').map(encodeURIComponent).join('/'),{method:'POST',body:JSON.stringify({expiresIn:300})});
      if(generation!==signing||!$('viewer').open)return;
      const rawSigned=result.signedURL;
      if(typeof rawSigned!=='string')throw new Error('Não foi possível abrir este documento.');
      const signed=new globalThis.URL(rawSigned.startsWith('/object/') ? '/storage/v1'+rawSigned : rawSigned,URL+'/storage/v1/');
      if(signed.origin!==URL||!signed.pathname.startsWith('/storage/v1/object/sign/fisqs/'))throw new Error('Endereço de documento inválido.');
      const open=text('a','Abrir PDF em outra aba','button primary');open.href=signed.href;open.target='_blank';open.rel='noopener noreferrer';
      const download=text('a','Baixar PDF','button'); const downloadUrl=new globalThis.URL(signed.href);downloadUrl.searchParams.set('download',revision.original_name);download.href=downloadUrl.href;download.target='_blank';download.rel='noopener noreferrer';
      $('viewer-links').append(open,download);$('pdf-frame').src=signed.href;$('pdf-frame').hidden=false;
      message('viewer-status','Se o PDF não aparecer abaixo, use “Abrir PDF em outra aba”. O link expira em 5 minutos; reabra o documento se necessário.');
    }catch(e){message('viewer-status',e.message,true);}
  }
  function editor(productId='',kind='safety') {
    if(!canWrite())return;
    $('upload-form').reset();$('product-choice').replaceChildren(new Option('Cadastrar novo produto',''),...products.map(p=>new Option([p.name,p.component].filter(Boolean).join(' · '),p.id)));
    $('product-choice').value=productId;$('upload-form').elements.kind.value=kind;toggleProductFields();message('upload-status','');$('editor').showModal();
  }
  function toggleProductFields(){const existing=!!$('product-choice').value;$('new-product').hidden=existing;$('upload-form').elements.name.required=!existing;$('editor-title').textContent=existing?'Adicionar documento / revisão':'Adicionar FISPQ';}
  async function save(event){
    event.preventDefault();if(saving||!canWrite())return;
    const f=$('upload-form').elements,file=f.pdf.files[0],productId=$('product-choice').value;
    try{
      if(!file||!file.name.toLowerCase().endsWith('.pdf')||file.size<5||file.size>15*1024*1024)throw new Error('Escolha um PDF de até 15 MB.');
      if(new TextDecoder().decode(await file.slice(0,5).arrayBuffer())!=='%PDF-')throw new Error('O arquivo selecionado não é um PDF válido.');
      if(f.summary.value.trim()&&!f.reviewed.checked)throw new Error('Confirme que conferiu o resumo com o documento original.');
      const previous=latest(productId).find(r=>r.kind===f.kind.value);
      if(previous?.revision_date&&f.revision_date.value&&f.revision_date.value<previous.revision_date)throw new Error('Esta revisão é anterior à versão atual. Confira a data antes de substituir.');
      saving=true;$('save').disabled=true;$('close-editor').disabled=true;message('upload-status','Enviando PDF…');
      const bytes=await file.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
      if(revisions.some(r=>r.product_id===productId&&r.kind===f.kind.value&&r.sha256===hash))throw new Error('Este PDF já está cadastrado para este produto e tipo.');
      const objectPath=`${session.user.id}/${crypto.randomUUID()}.pdf`;
      await request('/storage/v1/object/fisqs/'+objectPath,{method:'POST',headers:{'Content-Type':'application/pdf','x-upsert':'false'},body:file});
      try{
        await request('/rest/v1/rpc/fisqs_register',{method:'POST',body:JSON.stringify({p_product_id:productId||null,p_product:{name:f.name.value.trim(),manufacturer:f.manufacturer.value.trim(),code:f.code.value.trim(),component:f.component.value.trim(),category:f.category.value},p_revision:{kind:f.kind.value,revision_date:f.revision_date.value||null,revision_label:f.revision_label.value.trim(),original_name:file.name,object_path:objectPath,sha256:hash,scanned:f.scanned.checked,summary:f.summary.value.trim()}})});
      }catch(e){
        // Delete only unregistered uploads. RLS protects a committed revision if the response was lost.
        await request('/storage/v1/object/fisqs',{method:'DELETE',body:JSON.stringify({prefixes:[objectPath]})}).catch(()=>{});
        throw new Error(e.message+' Atualize o catálogo antes de tentar novamente para conferir se o cadastro foi concluído.');
      }
      $('editor').close();if($('detail').open)$('detail').close();await load();message('status','Documento salvo. As versões anteriores foram preservadas.');
    }catch(e){message('upload-status',e.message,true);}finally{saving=false;$('save').disabled=false;$('close-editor').disabled=false;}
  }
  function lock(){++authGeneration;session=null;role=null;products=[];revisions=[];$('results').replaceChildren();$('catalog').hidden=true;$('login-panel').hidden=false;$('logout').hidden=true;$('add').hidden=true;for(const id of ['editor','viewer','detail'])if($(id).open)$(id).close();$('upload-form').reset();$('detail-body').replaceChildren();$('viewer-links').replaceChildren();$('pdf-frame').removeAttribute('src');}
  $('login-form').addEventListener('submit',async event=>{
    event.preventDefault();const button=event.submitter;button.disabled=true;message('status','Entrando…');
    try{
      const employee=$('employee').value, pin=$('pin').value;
      if(!employee || !/^\d{4}$/.test(pin))throw new Error('Selecione seu nome e digite seu PIN de 4 dígitos.');
      const data=await raw('/auth/v1/signup',{method:'POST',body:JSON.stringify({data:{module:'fispq'}})},null);
      session={...data,expires_at:Date.now()/1000+data.expires_in};
      const access=await request('/rest/v1/rpc/fisqs_pin_login',{method:'POST',body:JSON.stringify({p_employee_name:employee,p_pin:pin})});
      role=access[0]?.role;if(!role)throw new Error('Não foi possível confirmar seu acesso.');
      $('login-panel').hidden=true;$('catalog').hidden=false;$('logout').hidden=false;$('add').hidden=!canWrite();await load();
    }catch(e){if(session)await raw('/auth/v1/logout?scope=local',{method:'POST'}).catch(()=>{});lock();message('status',e.message,true);}finally{$('pin').value='';button.disabled=false;}
  });
  $('logout').addEventListener('click',async()=>{if(saving)return;try{await request('/auth/v1/logout?scope=local',{method:'POST'});}catch{}finally{lock();message('status','Você saiu do módulo FISPQ.');}});
  $('search').addEventListener('input',render);$('category').addEventListener('change',render);$('retry').addEventListener('click',load);$('add').addEventListener('click',()=>editor());$('product-choice').addEventListener('change',toggleProductFields);$('upload-form').addEventListener('submit',save);
  $('editor').addEventListener('cancel',e=>{if(saving)e.preventDefault();});
  $('viewer').addEventListener('close',()=>{++signing;$('pdf-frame').removeAttribute('src');});
  document.addEventListener('click',e=>{const button=e.target.closest('button');if(!button)return;if(button.dataset.close)$(button.dataset.close).close();if(button.dataset.product)showDetails(button.dataset.product);if(button.dataset.open)view(button.dataset.open);if(button.dataset.update)editor(button.dataset.update,button.dataset.kind||'safety');});
  loadEmployees().catch(()=>message('status','Não foi possível carregar a lista de funcionários.',true));
  if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
