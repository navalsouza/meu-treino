/* Meu Treino 2.0 - sincronização direta Drive API via Google Identity Services.
   Nenhum token é persistido. OAuth deve rodar em HTTPS e com OAuth Client ID do usuário. */
(() => {
  'use strict';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const FOLDER_NAME = 'Meu Treino - Dados do Aplicativo';
  const STATE_NAME = 'estado-meu-treino.json';
  const CONFIG = 'mt2_google_client_id';
  const AUTOSYNC = 'mt2_auto_sync';
  const SNAPSHOT_META = 'mt2_drive_manifest';
  const DEVICE = 'mt2_device_id';
  const LAST_REMOTE = 'mt2_last_remote_modified';
  let token = null, client = null, folder = null, busy = false, changeTimer = 0, dirtyMedia = false;
  let remoteStateCache = null, lastSyncedLocalTime = 0;
  const $ = id => document.getElementById(id);
  const setStatus = (msg, level = 'info') => {
    if ($('driveStatus')) { $('driveStatus').textContent = msg; $('driveStatus').dataset.level = level; }
    if ($('statusCloudTopo')) {
      $('statusCloudTopo').textContent = level === 'success' ? '☁ Sincronizado' : level === 'error' ? '☁ Erro' : level === 'progress' ? '☁ Sincronizando…' : '☁ Drive';
      $('statusCloudTopo').dataset.level = level;
    }
  };
  function localIdentity() {
    let id = localStorage.getItem(DEVICE);
    if (!id) { id = (crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2)); localStorage.setItem(DEVICE, id); }
    return id;
  }
  const byteHash = async blob => {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
  };
  function requestError(res, body) {
    const message = body?.error?.message || body?.message || res.statusText;
    return new Error(`Google Drive (${res.status}): ${message}`);
  }
  async function call(url, options = {}) {
    if (!token) throw new Error('Conecte primeiro a conta Google.');
    if (!navigator.onLine) throw new Error('Sem internet. Seus treinos continuam salvos no aparelho.');
    const res = await fetch(url, { ...options, headers: {...options.headers, Authorization: 'Bearer ' + token} });
    const content = res.headers.get('content-type') || '';
    const out = content.includes('json') ? await res.json().catch(() => null) : await res.text().catch(() => '');
    if (!res.ok) {
      if (res.status === 401) { token = null; toggleButtons(); }
      throw requestError(res, out);
    }
    return out;
  }
  async function listChildren(parentId, fields = 'id,name,mimeType,modifiedTime,size', qExtra = '') {
    let list = [], pageToken = '';
    do {
      const query = `'${parentId}' in parents and trashed = false` + (qExtra ? ' and ' + qExtra : '');
      const qs = new URLSearchParams({q:query, fields:`nextPageToken,files(${fields})`, pageSize:'1000'});
      if (pageToken) qs.set('pageToken', pageToken);
      const body = await call(API + '/files?' + qs);
      list = list.concat(body.files || []); pageToken = body.nextPageToken || '';
    } while (pageToken);
    return list;
  }
  async function locateFolder() {
    if (folder) return folder;
    const qs = new URLSearchParams({
      q:`name = '${FOLDER_NAME.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields:'nextPageToken,files(id,name,modifiedTime)', pageSize:'100'
    });
    const result = await call(API + '/files?' + qs);
    if (result.files?.length) { folder = result.files[0].id; return folder; }
    const created = await call(API + '/files?fields=id,name', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({name:FOLDER_NAME, mimeType:'application/vnd.google-apps.folder'})
    });
    folder = created.id; return folder;
  }
  async function findNamed(name) {
    const found = await listChildren(await locateFolder(), 'id,name,mimeType,modifiedTime,size', `name = '${name.replace(/'/g,"\\'")}'`);
    return found.sort((a,b)=>String(b.modifiedTime).localeCompare(String(a.modifiedTime)))[0] || null;
  }
  function safeMediaName(id) { return 'midia-' + encodeURIComponent(id).replace(/%/g, '_') + '.bin'; }
  async function resumableUpload(name,blob,mimeType,existing) {
    const url = existing ? UPLOAD + '/files/' + encodeURIComponent(existing.id) + '?uploadType=resumable&fields=id,name,modifiedTime'
      : UPLOAD + '/files?uploadType=resumable&fields=id,name,modifiedTime';
    const metadata = existing ? {name} : {name,parents:[await locateFolder()]};
    const initiation = await fetch(url,{
      method:existing?'PATCH':'POST',
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json; charset=UTF-8',
        'X-Upload-Content-Type':mimeType,'X-Upload-Content-Length':String(blob.size)},
      body:JSON.stringify(metadata)
    });
    if (!initiation.ok) throw requestError(initiation,await initiation.json().catch(()=>null));
    const location = initiation.headers.get('Location');
    if (!location) throw new Error('Google Drive não disponibilizou o endereço do envio retomável.');
    const uploaded = await fetch(location,{
      method:'PUT', headers:{Authorization:'Bearer '+token,'Content-Type':mimeType,
        'Content-Range':`bytes 0-${blob.size-1}/${blob.size}`},body:blob
    });
    if (!uploaded.ok) throw requestError(uploaded,await uploaded.json().catch(()=>null));
    return uploaded.json();
  }
  async function upsert(name, blob, mimeType = 'application/octet-stream') {
    const file = await findNamed(name);
    if (blob.size > 5*1024*1024) return resumableUpload(name,blob,mimeType,file);
    if (file) {
      const data = await call(UPLOAD + '/files/' + encodeURIComponent(file.id) + '?uploadType=media&fields=id,name,modifiedTime', {
        method:'PATCH', headers:{'Content-Type': mimeType}, body:blob
      });
      return data;
    }
    const boundary = 'mt2_' + Math.random().toString(36).slice(2);
    const meta = {name, parents:[await locateFolder()]};
    const multipart = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`, blob, `\r\n--${boundary}--`
    ], {type:'multipart/related; boundary=' + boundary});
    return call(UPLOAD + '/files?uploadType=multipart&fields=id,name,modifiedTime', {
      method:'POST', headers:{'Content-Type':'multipart/related; boundary=' + boundary},body:multipart
    });
  }

  async function getRemoteState() {
    const file = await findNamed(STATE_NAME);
    if (!file) return null;
    const obj = await call(API + '/files/' + encodeURIComponent(file.id) + '?alt=media');
    const parsed = typeof obj === 'string' ? JSON.parse(obj) : obj;
    if (parsed?.formato !== 'meu-treino-drive-v1' || !parsed.armazenamento || !Array.isArray(parsed.midias))
      throw new Error('O arquivo do Drive não está no formato esperado. Nenhum dado foi alterado.');
    return {file, data:parsed};
  }
  function getLocalMeta() {
    try { return JSON.parse(localStorage.getItem(SNAPSHOT_META)) || {midias:[]}; }
    catch { return {midias:[]}; }
  }
  function getLocalFields() {
    const armazenamento = {};
    if (typeof chavesDoTreino !== 'function') throw new Error('A ficha de treino não foi carregada.');
    for (const key of chavesDoTreino()) {
      const value = localStorage.getItem(key);
      if (value !== null) armazenamento[key] = value;
    }
    return armazenamento;
  }
  const stamp = () => new Date().toISOString();
  const localChanges = () => +(localStorage.getItem('mt2_dirty_at') || '0');
  function markChanged(media = false) {
    if (media) dirtyMedia = true;
    localStorage.setItem('mt2_dirty_at', String(Date.now()));
    if (localStorage.getItem(AUTOSYNC) === '1' && token && !busy && getLocalMeta().snapshotId) {
      clearTimeout(changeTimer);
      changeTimer = setTimeout(() => send({automatic:true,includeMedia:dirtyMedia}), 18000);
    }
  }
  function syncButtonsDisabled(value) {
    for (const id of ['conectarDrive','enviarDrive','receberDrive']) if ($(id)) $(id).disabled = value;
  }
  function toggleButtons() {
    if ($('conectarDrive')) $('conectarDrive').textContent = token ? 'Reconectar Google' : 'Conectar Google';
    for (const id of ['enviarDrive','receberDrive']) if ($(id)) $(id).disabled = !token || busy;
  }
  async function ensureToken() {
    const id = $('googleClientId')?.value.trim();
    if (!id || !/^[0-9A-Za-z._-]+\.apps\.googleusercontent\.com$/.test(id)) throw new Error('Informe um OAuth Client ID válido do Google (termina em .apps.googleusercontent.com).');
    if (!window.isSecureContext || location.protocol === 'file:' || location.protocol === 'content:') throw new Error('Conexão Google exige abrir o PWA por HTTPS ou localhost, não por arquivo HTML.');
    if (!window.google?.accounts?.oauth2) throw new Error('O módulo de autenticação Google não carregou. Verifique conexão ou bloqueadores de conteúdo.');
    localStorage.setItem(CONFIG, id);
    return new Promise((resolve,reject) => {
      const c = google.accounts.oauth2.initTokenClient({
        client_id:id, scope:SCOPE,
        callback:(response) => response?.access_token ? resolve(response.access_token) : reject(new Error(response?.error_description || response?.error || 'Autorização não concluída.')),
        error_callback:(e) => reject(new Error(e?.message || e?.type || 'Não foi possível abrir autorização Google.'))
      });
      client = c; c.requestAccessToken({prompt:'consent'});
    });
  }
  async function connect() {
    try {
      setStatus('Abrindo autorização Google…','progress');
      token = await ensureToken();
      await locateFolder();
      const remote = await getRemoteState(); remoteStateCache = remote;
      toggleButtons();
      if (remote) setStatus(`Conectado. Há registros no Drive (${new Date(remote.data.salvoEm).toLocaleString('pt-BR')}). Escolha Enviar ou Carregar.`, 'ready');
      else setStatus('Conta conectada. Ainda não há ficha na nuvem. Toque em Enviar para criar a primeira cópia.', 'ready');
    } catch (err) { setStatus('Falha ao conectar: ' + err.message,'error'); toggleButtons(); }
  }
  async function send({automatic=false, includeMedia=true} = {}) {
    if (busy || !token) return;
    if (!automatic && !confirm('Enviar o estado atual do aparelho ao Google Drive? Uma cópia da ficha existente no Drive será atualizada.')) return;
    const atStart = localChanges();
    busy=true; syncButtonsDisabled(true);
    try {
      setStatus('Conferindo versão do Drive…','progress');
      const remote = await getRemoteState();
      const lastSeen = localStorage.getItem(LAST_REMOTE);
      const cloudModified = remote?.file?.modifiedTime || '';
      if (remote && cloudModified && cloudModified !== lastSeen && localChanges() &&
          (automatic || !confirm('O Drive foi modificado por outro dispositivo desde sua última sincronização. Enviar assim mesmo pode substituir esses registros. Deseja continuar?'))) {
        setStatus('Conflito evitado. Use Carregar do Drive ou exporte um backup antes de sobrescrever.', 'error'); return;
      }
      // Cache do manifesto para não reenviar imagens ao registrar apenas uma série.
      let mediaMeta = [...(getLocalMeta().midias || [])];
      if (includeMedia || dirtyMedia) {
        if (typeof lerTodasAsMidias !== 'function') throw new Error('Sistema de mídias indisponível');
        const list = await lerTodasAsMidias();
        const old = new Map(mediaMeta.map(m=>[m.id,m]));
        const updated = [];
        let i = 0;
        for (const {id,blob} of list) {
          i++;
          if (!(blob instanceof Blob)) continue;
          setStatus(`Sincronizando mídia ${i}/${list.length}: ${id}`,'progress');
          const sha256 = await byteHash(blob);
          const previous = old.get(id);
          if (previous?.sha256 === sha256 && previous?.fileId) {updated.push(previous);continue;}
          const name = safeMediaName(id);
          const uploaded = await upsert(name, blob, blob.type || 'application/octet-stream');
          updated.push({id, name, fileId:uploaded.id, mimeType:blob.type || 'application/octet-stream',size:blob.size,sha256});
        }
        mediaMeta=updated;
      }
      setStatus('Enviando registros do treino…','progress');
      const snapshot = {
        formato:'meu-treino-drive-v1', schemaVersion:1, salvoEm:stamp(),
        dispositivo:localIdentity(), armazenamento:getLocalFields(), midias:mediaMeta,
        exercicios:'Treino A-B-D-E-C / histórico preservado'
      };
      const response = await upsert(STATE_NAME, new Blob([JSON.stringify(snapshot)], {type:'application/json'}), 'application/json');
      localStorage.setItem(SNAPSHOT_META, JSON.stringify({midias:mediaMeta,snapshotId:response.id}));
      localStorage.setItem(LAST_REMOTE, response.modifiedTime || (await findNamed(STATE_NAME))?.modifiedTime || '');
      lastSyncedLocalTime = atStart;
      if (localChanges() === atStart) localStorage.removeItem('mt2_dirty_at');
      dirtyMedia=false; remoteStateCache={file:{id:response.id,modifiedTime:response.modifiedTime},data:snapshot};
      setStatus(`✓ Sincronizado com o Drive: ${mediaMeta.length} mídias e registros de treino.`, 'success');
    } catch(err) { setStatus('Falha na sincronização: '+err.message, 'error'); }
    finally {busy=false;toggleButtons();}
  }
  async function receive() {
    if (busy || !token) return;
    if (!confirm('Carregar do Drive substituirá os registros atuais deste navegador. Tenha um backup local antes de continuar. Deseja prosseguir?')) return;
    busy=true;syncButtonsDisabled(true);
    try {
      setStatus('Buscando dados no Google Drive…','progress');
      const remote = await getRemoteState();
      if (!remote) {setStatus('Não há dados no Drive ainda.','error');return;}
      const obj = {formato:'meu-treino-backup', versao:1, geradoEm:remote.data.salvoEm,
        aplicativo:'Meu Treino de Hipertrofia', armazenamento:remote.data.armazenamento, midias:[]};
      let i = 0;
      for (const media of remote.data.midias) {
        setStatus(`Baixando mídia ${++i}/${remote.data.midias.length}…`, 'progress');
        const r = await fetch(API + '/files/' + encodeURIComponent(media.fileId) + '?alt=media', {headers:{Authorization:'Bearer '+token}});
        if (!r.ok) throw requestError(r, await r.json().catch(()=>null));
        const blob = await r.blob();
        if (await byteHash(blob) !== media.sha256) throw new Error('Mídia corrompida: '+media.id);
        const dataUrl = await new Promise((resolve,reject) => {const rd=new FileReader();rd.onload=()=>resolve(rd.result);rd.onerror=()=>reject(rd.error);rd.readAsDataURL(blob)});
        obj.midias.push({id:media.id,conteudo:dataUrl});
      }
      // Reutilizar o restaurador existente, inclusive validação e recuperação.
      await restaurarBackup(new File([JSON.stringify(obj)],'restauracao-drive.json',{type:'application/json'}));
      const restored = $('backupStatus')?.textContent?.includes('Restauração concluída');
      if (restored) {
        localStorage.setItem(SNAPSHOT_META, JSON.stringify({midias:remote.data.midias,snapshotId:remote.file.id}));
        localStorage.setItem(LAST_REMOTE, remote.file.modifiedTime || '');
        localStorage.removeItem('mt2_dirty_at'); dirtyMedia=false;lastSyncedLocalTime=0;
        setStatus('✓ Dados e mídias restaurados do Drive.', 'success');
      } else setStatus('A restauração não foi concluída ou foi cancelada. Os dados do Drive não foram alterados.', 'error');
    }catch(err) {setStatus('Falha ao restaurar do Drive: '+err.message,'error');}
    finally {busy=false;toggleButtons();}
  }
  function init() {
    if ($('googleClientId')) $('googleClientId').value = localStorage.getItem(CONFIG) || '';
    if ($('autoSyncDrive')) $('autoSyncDrive').checked = localStorage.getItem(AUTOSYNC) === '1';
    $('conectarDrive')?.addEventListener('click',connect);
    $('enviarDrive')?.addEventListener('click',()=>send({includeMedia:true}));
    $('receberDrive')?.addEventListener('click',receive);
    $('autoSyncDrive')?.addEventListener('change',e=>{
      localStorage.setItem(AUTOSYNC,e.target.checked?'1':'0');
      setStatus(e.target.checked?'Envio automático de alterações ativado (quando conectado).':'Envio automático desativado.');
    });
    toggleButtons();
    if (!window.isSecureContext) setStatus('Abra o aplicativo via HTTPS para conectar sua conta Google. O modo offline continua disponível.');
    // Acopla a sincronização sem alterar a estrutura histórica dos arquivos.
    if (typeof salvar === 'function') {
      const orig = salvar;
      salvar = function(...args) {const result=orig.apply(this,args);markChanged();return result;};
    }
    if (typeof guardarFoto === 'function') {
      const orig = guardarFoto;
      guardarFoto = async function(...args) {const result=await orig.apply(this,args);markChanged(true);return result;};
    }
    if (typeof excluirFoto === 'function') {
      const orig = excluirFoto;
      excluirFoto = async function(...args) {const result=await orig.apply(this,args);markChanged(true);return result;};
    }
    // Remapeamentos em lote do gerenciador de fichas usam transações diretas do IndexedDB.
    // Avise a sincronização para incluir as novas chaves das mídias.
    window.addEventListener('meu-treino-midias-alteradas',()=>markChanged(true));
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('Service worker não instalado:',err));
    }
    window.addEventListener('online',()=>setStatus(token?'Internet restaurada. Você pode sincronizar.':'Online. Conecte Google para sincronizar.'));
    window.addEventListener('offline',()=>setStatus('Offline: os registros continuam salvos no celular.'));
  }
  init();
})();