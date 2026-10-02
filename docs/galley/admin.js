'use strict';
const API = 'https://mbqizwojhfwxpgkbayhr.supabase.co/functions/v1/galley-api';
const KEY = 'galley-admin-session-v1';
const $ = id => document.getElementById(id);
const TYPES = {game:'游戏',film:'电影',series:'剧集'};
const DIMS = [['story','剧情'],['gameplay','玩法'],['visuals','画面与美术 / 摄影'],['audio','音乐与音效'],['atmosphere','氛围与沉浸'],['performance','演出 / 表演'],['characters','角色'],['pacing','节奏']];
let session = null, setup = false, items = [], editing = null, refreshing = null;
let filter = 'all', sort = 'experienced-desc', viewing = null;
const VIEW_DIMS = {
  game:[['story','剧情'],['gameplay','玩法'],['visuals','画面与美术'],['audio','音乐与音效'],['atmosphere','氛围与沉浸'],['performance','演出']],
  film:[['story','剧情'],['characters','角色'],['performance','表演'],['visuals','画面与摄影'],['audio','音乐与声音'],['pacing','节奏']],
  series:[['story','剧情'],['characters','角色'],['performance','表演'],['visuals','画面与摄影'],['audio','音乐与声音'],['pacing','节奏']]
};
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const scoreFields = {};
function openDialog(id) { if (!$(id).open) $(id).showModal(); }
function closeDialog(id) { if ($(id).open) $(id).close(); }
function controls() {
  for (const id of ['new','tools-open','logout']) $(id).hidden = !session;
  $('login-open').hidden = !!session;
  $('detail-edit').hidden = !session;
}
try { session = JSON.parse(sessionStorage.getItem(KEY)); } catch {}
function message(text, bad = false) {
  $('status').textContent = text;
  $('status').className = 'status ' + (bad ? 'bad' : 'ok');
  for (const id of ['auth','editor','tools']) {
    if ($(id).open) {
      $(id + '-status').textContent = text;
      $(id + '-status').className = bad ? 'bad' : 'muted';
    }
  }
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
  closeDialog('editor'); closeDialog('tools');
  controls();
  render();
  openDialog('auth');
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
  const data = session ? await api('list', {method:'GET'}) : await request('list', {method:'GET'});
  items = data.items || [];
  controls();
  render();
  closeDialog('auth'); closeDialog('editor'); closeDialog('detail-dialog');
  message(session ? '管理模式：点击卡片查看详情，或点击“编辑”。' : '');
}
function card(item) {
  return '<article class="card"><button type="button" class="card-open" data-view="'+esc(item.id)+'" aria-label="查看 '+esc(item.title)+'"><div class="cover">'+(item.cover?'<img src="'+esc(item.cover)+'" alt="" loading="lazy">':'<div class="ph">'+esc(item.title)+'</div>')+'</div><div class="body"><div class="meta">'+esc(TYPES[item.type]||item.type)+' · '+esc(item.year||'—')+'</div><h3>'+esc(item.title)+'</h3><div class="rating">'+(Number(item.rating)?Number(item.rating).toFixed(1)+'/10':'未评分')+'</div></div></button>'+(session?'<button type="button" class="card-edit" data-edit="'+esc(item.id)+'" aria-label="编辑 '+esc(item.title)+'">编辑</button>':'')+'</article>';
}
function render() {
  const q = $('q').value.toLowerCase();
  const list = items.filter(x => (filter === 'all' || x.type === filter) && (!q || [x.title,x.review,...(x.tags||[])].join(' ').toLowerCase().includes(q)));
  const byName = (a,b) => a.title.localeCompare(b.title,undefined,{numeric:true,sensitivity:'base'});
  let html = '';
  if (sort.startsWith('experienced')) {
    const years = [...new Set(list.map(x => Number(x.experienced)||null).filter(Boolean))].sort((a,b) => sort === 'experienced-desc' ? b-a : a-b);
    for (const year of years) html += '<section class="year"><h2>'+year+'</h2><div class="grid">'+list.filter(x=>Number(x.experienced)===year).sort(byName).map(card).join('')+'</div></section>';
    const undated = list.filter(x=>!x.experienced).sort(byName);
    if (undated.length) html += '<section class="year"><h2>未填写接触年份</h2><div class="grid">'+undated.map(card).join('')+'</div></section>';
  } else {
    list.sort(sort === 'rating' ? (a,b)=>(b.rating||0)-(a.rating||0)||byName(a,b) : byName);
    html = '<div class="grid">'+list.map(card).join('')+'</div>';
  }
  $('items').innerHTML = list.length ? html : '<div class="empty">'+(items.length?'没有找到匹配的作品。':'这里还没有云端作品。')+'</div>';
  $('all').textContent = items.length;
  $('games').textContent = items.filter(x=>x.type==='game').length;
  $('screen').textContent = items.filter(x=>x.type!=='game').length;
  const ratings = items.map(x=>Number(x.rating)).filter(Boolean);
  $('avg').textContent = ratings.length ? (ratings.reduce((a,b)=>a+b,0)/ratings.length).toFixed(1) : '—';
}
function showDetail(item) {
  viewing = item;
  const scores = item.scores || {};
  const cover = item.cover ? '<img src="'+esc(item.cover)+'" alt="">' : '<div class="placeholder">'+esc(item.title)+'</div>';
  const dims = (VIEW_DIMS[item.type]||VIEW_DIMS.game).map(([key,label]) => {
    const v = scores[key], n = Number(v), present = v !== undefined && v !== null && v !== '';
    return '<div class="score"><div class="scorehead"><div>'+label+'</div><div class="scorenum">'+(present?n.toFixed(1):'—')+'</div></div><div class="bar"><span style="width:'+Math.min(100,Math.max(0,n*10||0))+'%"></span></div></div>';
  }).join('');
  $('detail-content').innerHTML = '<section class="hero"><div class="cover">'+cover+'</div><div><div class="kicker">'+esc(TYPES[item.type]||item.type)+'</div><h1 class="title">'+esc(item.title)+'</h1><div class="meta">'+esc(item.year||'未知年份')+(item.experienced?' · 接触于 '+esc(item.experienced):'')+'</div><div class="overall"><div class="scorebig">'+(Number(item.rating)>0?Number(item.rating).toFixed(1):'—')+'</div><div class="outof">/ 10</div></div><div class="tags" style="margin-top:22px">'+(item.tags||[]).map(x=>'<span class="tag">'+esc(x)+'</span>').join('')+'</div></div></section><section class="section"><h2>分项评分</h2><div class="scores">'+dims+'</div></section><section class="section"><h2>我的体验</h2><div class="review">'+esc(item.review||'还没有写。')+'</div></section>';
  controls();
  openDialog('detail-dialog');
}
function edit(item) {
  if (!session) { showAuth(false); return; }
  editing = item || {id:crypto.randomUUID(), title:'', type:'game', tags:[], scores:{}, favorite:false};
  for (const key of ['title','type','year','experienced','rating','excerpt','review']) $(key).value = editing[key] ?? '';
  $('favorite').value = String(!!editing.favorite);
  $('tags').value = (editing.tags || []).join(', ');
  $('cover').value = ''; $('clear-cover').checked = false;
  $('cover-preview').hidden = !editing.cover;
  $('cover-preview').src = editing.cover || '';
  for (const [key] of DIMS) $('score-' + key).value = editing.scores?.[key] ?? '';
  $('editor-title').textContent = item ? '编辑作品' : '添加作品';
  $('delete').hidden = !item;
  closeDialog('detail-dialog');
  $('editor-status').textContent = '';
  updateDimensions();
  openDialog('editor');
  message('编辑完成后，点击“保存到云端”。');
  $('title').focus();
}
function updateDimensions() {
  const shown = new Map(VIEW_DIMS[$('type').value] || VIEW_DIMS.game);
  for (const [key] of DIMS) {
    scoreFields[key].hidden = !shown.has(key);
    if (shown.has(key)) scoreFields[key].children[0].textContent = shown.get(key) + ' / 10';
  }
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
  scoreFields[key] = field;
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
$('cancel').onclick = () => { closeDialog('editor'); message('未保存的修改已取消。'); };
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
  remember(null); closeDialog('tools'); closeDialog('detail-dialog'); controls(); render(); message('已退出登录。');
});
$('q').oninput = render;
$('sort').onchange = event => { sort = event.target.value; render(); };
document.querySelectorAll('[data-f]').forEach(button => button.onclick = () => {
  document.querySelectorAll('[data-f]').forEach(x => x.classList.remove('active'));
  button.classList.add('active'); filter = button.dataset.f; render();
});
$('items').onclick = event => {
  const button = event.target.closest('[data-view],[data-edit]');
  if (!button) return;
  const item = items.find(x => x.id === (button.dataset.view || button.dataset.edit));
  if (item) button.dataset.edit ? edit(item) : showDetail(item);
};
$('detail-edit').onclick = () => { if (viewing) edit(viewing); };
$('detail-close').onclick = () => closeDialog('detail-dialog');
$('editor-close').onclick = $('cancel').onclick;
$('auth-close').onclick = () => closeDialog('auth');
$('tools-close').onclick = () => closeDialog('tools');
$('tools-open').onclick = () => { if (session) { $('tools-status').textContent = ''; openDialog('tools'); } };
$('login-open').onclick = () => showAuth(setup);
$('type').onchange = updateDimensions;
async function boot() {
  try { await dashboard(); } catch(e) { message(e.message,true); }
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
