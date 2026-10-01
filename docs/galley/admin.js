'use strict';
const API = 'https://mbqizwojhfwxpgkbayhr.supabase.co/functions/v1/galley-api';
const KEY = 'galley-admin-session-v1';
const $ = id => document.getElementById(id);
const TYPES = {game:'游戏',film:'电影',series:'剧集'};
const DIMS = [['story','剧情'],['gameplay','玩法'],['visuals','画面与美术 / 摄影'],['audio','音乐与音效'],['atmosphere','氛围与沉浸'],['performance','演出 / 表演'],['characters','角色'],['pacing','节奏']];
let session = null, setup = false, items = [], editing = null, refreshing = null;
try { session = JSON.parse(sessionStorage.getItem(KEY)); } catch {}
function message(text, bad = false) {
  $('status').textContent = text;
  $('status').className = 'status ' + (bad ? 'bad' : 'ok');
}
function remember(value) {
  session = value;
  try { value ? sessionStorage.setItem(KEY, JSON.stringify(value)) : sessionStorage.removeItem(KEY); } catch {}
}
async function request(action, {method='POST', body, token} = {}) {
  let response;
  try {
    response = await fetch(API + '?action=' + encodeURIComponent(action), {
      method, cache:'no-store', signal:AbortSignal.timeout(25000),
      headers:{'Content-Type':'application/json', ...(token ? {Authorization:'Bearer ' + token} : {})},
      ...(body !== undefined ? {body:JSON.stringify(body)} : {})
    });
  } catch (e) {
    throw new Error(e.name === 'TimeoutError' ? '连接云端超时，请重试。' : '连接云端失败，请检查网络后重试。');
  }
  const data = await response.json().catch(() => { throw new Error('云端返回了无法读取的响应，请刷新页面。'); });
  if (!response.ok) {
    const error = new Error(data.error || '操作失败（' + response.status + '）');
    error.status = response.status;
    throw error;
  }
  return data;
}
async function refreshSession() {
  if (!session?.refresh_token) throw new Error('请重新登录。');
  if (!refreshing) {
    refreshing = request('refresh', {body:{refresh_token:session.refresh_token}})
      .then(data => remember(data.session)).finally(() => { refreshing = null; });
  }
  await refreshing;
}
async function api(action, options = {}) {
  if (!session) throw new Error('请先登录。');
  try {
    if ((session.expires_at || 0) * 1000 < Date.now() + 30000) await refreshSession();
    try { return await request(action, {...options, token:session.access_token}); }
    catch (e) {
      if (e.status !== 401) throw e;
      await refreshSession();
      return await request(action, {...options, token:session.access_token});
    }
  } catch (e) {
    if (e.status === 401) { remember(null); showAuth(false); }
    throw e;
  }
}
function showAuth(initialSetup) {
  setup = initialSetup;
  $('auth').hidden = false;
  $('dashboard').hidden = $('editor').hidden = $('logout').hidden = true;
  $('code-field').hidden = $('setup-note').hidden = !setup;
  $('code').required = setup;
  $('password').minLength = setup ? 10 : 1;
  $('password').autocomplete = setup ? 'new-password' : 'current-password';
  $('auth-title').textContent = setup ? '创建管理员账号' : '管理员登录';
  $('login').textContent = setup ? '创建账号并登录' : '登录';
}
async function run(button, task) {
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try { await task(); } catch (e) { message(e.message, true); }
  finally { if (button) button.disabled = false; }
}
async function dashboard() {
  const data = await api('list', {method:'GET'});
  items = data.items || [];
  items.sort((a,b) => (b.experienced || 0) - (a.experienced || 0) || a.title.localeCompare(b.title));
  $('items').replaceChildren();
  $('count').textContent = '作品（' + items.length + '）';
  for (const item of items) {
    const row = document.createElement('div'); row.className = 'item';
    const info = document.createElement('div');
    const title = document.createElement('b'); title.textContent = item.title;
    const meta = document.createElement('div'); meta.className = 'muted';
    meta.textContent = (TYPES[item.type] || item.type) + ' · 接触 ' + (item.experienced || '—') + ' · ' + (Number(item.rating) || 0).toFixed(1) + '/10';
    info.append(title, meta);
    const button = document.createElement('button'); button.textContent = '编辑';
    button.onclick = () => edit(item);
    row.append(info, button); $('items').append(row);
  }
  $('auth').hidden = $('editor').hidden = true;
  $('dashboard').hidden = $('logout').hidden = false;
  message('已连接云端。保存后的内容会在各设备刷新页面时显示。');
}
function edit(item) {
  editing = item || {id:crypto.randomUUID(), title:'', type:'game', tags:[], scores:{}, favorite:false};
  for (const key of ['title','type','year','experienced','rating','excerpt','review']) $(key).value = editing[key] ?? '';
  $('favorite').value = String(!!editing.favorite);
  $('tags').value = (editing.tags || []).join(', ');
  $('cover').value = ''; $('clear-cover').checked = false;
  for (const [key] of DIMS) $('score-' + key).value = editing.scores?.[key] ?? '';
  $('editor-title').textContent = item ? '编辑作品' : '添加作品';
  $('delete').hidden = !item;
  $('dashboard').hidden = true; $('editor').hidden = false;
  message('编辑完成后，点击“保存到云端”。');
  $('title').focus();
}
function number(id) { return $(id).value.trim() === '' ? null : Number($(id).value); }
function fileURL(file) {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('图片读取失败。'));
    reader.readAsDataURL(file);
  });
}
async function save() {
  const file = $('cover').files[0];
  let cover = $('clear-cover').checked ? null : editing.cover || null;
  if (file) {
    if (file.size > 2000000) throw new Error('封面超过 2 MB，请压缩后上传。');
    if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) throw new Error('请使用 JPG、PNG、WebP 或 GIF 图片。');
    cover = await fileURL(file);
  }
  const scores = {...(editing.scores || {})};
  for (const [key] of DIMS) {
    const value = number('score-' + key);
    if (value === null) delete scores[key]; else scores[key] = value;
  }
  const item = {
    id:editing.id, title:$('title').value.trim(), type:$('type').value,
    year:number('year'), experienced:number('experienced'), rating:number('rating') ?? 0,
    favorite:$('favorite').value === 'true',
    tags:$('tags').value.split(/[,，]/).map(x => x.trim()).filter(Boolean),
    excerpt:$('excerpt').value, review:$('review').value, cover, scores
  };
  await api('upsert', {body:{item}});
  await dashboard(); message('已保存到云端。');
}
for (const [key,label] of DIMS) {
  const field = document.createElement('div'); field.className = 'field';
  const text = document.createElement('label'); text.htmlFor = 'score-' + key; text.textContent = label + ' / 10';
  const input = document.createElement('input');
  Object.assign(input, {id:'score-' + key, type:'number', min:'0', max:'10', step:'.1'});
  field.append(text,input); $('scores').append(field);
}
$('auth-form').onsubmit = event => {
  event.preventDefault();
  run($('login'), async () => {
    const email = $('email').value.trim(), password = $('password').value;
    message(setup ? '正在创建管理员账号……' : '正在登录……');
    if (setup) {
      await request('setup', {body:{email,password,code:$('code').value}});
      showAuth(false);
      message('账号已创建，正在登录……');
    }
    const data = await request('login', {body:{email,password}});
    remember(data.session);
    $('password').value = $('code').value = '';
    $('account').textContent = '管理员：' + data.user.email;
    await dashboard();
  });
};
$('edit-form').onsubmit = event => { event.preventDefault(); run(event.submitter, save); };
$('new').onclick = () => edit(null);
$('cancel').onclick = () => { $('editor').hidden = true; $('dashboard').hidden = false; message('未保存的修改已取消。'); };
$('refresh').onclick = () => run($('refresh'), dashboard);
$('delete').onclick = () => {
  if (!confirm('确定删除“' + editing.title + '”吗？')) return;
  run($('delete'), async () => { await api('delete', {method:'DELETE',body:{id:editing.id}}); await dashboard(); message('作品已删除。'); });
};
$('export').onclick = () => run($('export'), async () => {
  const data = await api('list', {method:'GET'});
  const blob = new Blob([JSON.stringify({version:3,exportedAt:new Date().toISOString(),items:data.items},null,2)], {type:'application/json'});
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'galley-cloud-backup.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href),1000);
  message('云端备份已导出。');
});
$('import-form').onsubmit = event => {
  event.preventDefault();
  run(event.submitter, async () => {
    const data = JSON.parse(await $('backup').files[0].text());
    const rows = Array.isArray(data) ? data : data.items;
    if (!Array.isArray(rows) || rows.some(x => !x || !x.id || !x.title)) throw new Error('备份格式不正确：每条作品都需要 ID 和标题。');
    let done = 0;
    for (let i=0;i<rows.length;i+=10) {
      try { await api('bulk',{body:{items:rows.slice(i,i+10)}}); done += Math.min(10,rows.length-i); }
      catch(e) { throw new Error('已导入 ' + done + ' 条，后续失败：' + e.message + '。可以重试，已有 ID 不会重复。'); }
      message('正在导入：' + done + ' / ' + rows.length);
    }
    await dashboard(); message('导入完成，共 ' + done + ' 条。');
  });
};
$('bulk-form').onsubmit = event => {
  event.preventDefault();
  run(event.submitter, async () => {
    const rows = $('lines').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean).map(line => {
      const [title,year,experienced,rating] = line.split(/\s*[|｜]\s*/);
      const n = x => !x?.trim() ? null : Number(x);
      const item = {id:crypto.randomUUID(),title,type:$('bulk-type').value,year:n(year),experienced:n(experienced),rating:n(rating) ?? 0};
      if (Object.values(item).some(x => typeof x === 'number' && !Number.isFinite(x)) || item.rating < 0 || item.rating > 10) throw new Error('这一行的年份或评分不正确：' + line);
      return item;
    });
    if (!rows.length) throw new Error('请至少填写一部作品。');
    await api('bulk',{body:{items:rows}});
    $('lines').value = ''; await dashboard(); message('已加入 ' + rows.length + ' 条。');
  });
};
$('logout').onclick = () => run($('logout'), async () => {
  try { if(session) await request('logout',{token:session.access_token}); } catch {}
  remember(null); showAuth(false); message('已退出登录。');
});
async function boot() {
  if (session) {
    try {
      const result = await api('verify');
      if (result.admin) { $('account').textContent = '管理员：' + result.email; await dashboard(); return; }
    } catch {}
    remember(null);
  }
  try {
    const data = await request('setup-status',{method:'GET'});
    showAuth(data.setup_available);
    message(setup ? '请先创建你的管理员账号。' : '请输入邮箱和密码。');
  } catch(e) { showAuth(false); message(e.message,true); }
}
boot();
