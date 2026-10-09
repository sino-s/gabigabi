'use strict';

const $ = id => document.getElementById(id);
const ui = Object.fromEntries(['file', 'dropzone', 'demo', 'settings', 'quality', 'quality-value', 'rounds', 'rounds-value', 'size', 'variation', 'run', 'cancel', 'status', 'counter', 'progress', 'before', 'after', 'before-empty', 'after-empty', 'before-meta', 'after-meta', 'result-info', 'download'].map(id => [id, $(id)]));
let source = null;
let sourceName = 'image';
let beforeURL = null;
let resultURL = null;
let busy = false;
let loading = false;
let cancelled = false;
let loadVersion = 0;

function message(text) { ui.status.textContent = text; }
function blobFromCanvas(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('JPEGの生成に失敗しました。画像を小さくして試してください。')), 'image/jpeg', quality));
}
function decode(blob) {
  // HTMLImageElement also supports browsers without createImageBitmap.
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('この画像を読み込めませんでした。JPEG・PNG・WebPなどで試してください。')); };
    image.src = url;
  });
}
function clearResult() {
  if (resultURL) URL.revokeObjectURL(resultURL);
  resultURL = null;
  ui.after.removeAttribute('src');
  ui.after.hidden = true;
  ui['after-empty'].hidden = false;
  ui.download.removeAttribute('href');
  ui.download.classList.add('disabled');
  ui.download.setAttribute('aria-disabled', 'true');
  ui['after-meta'].textContent = '再保存後';
  ui['result-info'].textContent = '気に入ったガビ具合を持ち帰ろう。';
  ui.progress.value = 0;
  ui.counter.textContent = '—';
}
function refreshControls() {
  ui.run.disabled = busy || loading || !source;
  ui.file.disabled = busy;
  ui.demo.disabled = busy;
  ui.settings.disabled = busy;
  ui.cancel.hidden = !busy;
}
async function loadFile(file) {
  if (busy || !file) return;
  const version = ++loadVersion;
  loading = true;
  refreshControls();
  message('画像を読み込み中…');
  try {
    if (file.size > 40 * 1024 * 1024) throw new Error('画像は40MB以下で選んでください。');
    if (file.type && !file.type.startsWith('image/')) throw new Error('画像ファイルを選んでください。');
    const image = await decode(file);
    if (version !== loadVersion) return;
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('画像のサイズを取得できませんでした。');
    source = image;
    sourceName = (file.name || 'sample').replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    if (beforeURL) URL.revokeObjectURL(beforeURL);
    beforeURL = URL.createObjectURL(file);
    ui.before.src = beforeURL;
    ui.before.hidden = false;
    ui['before-empty'].hidden = true;
    ui['before-meta'].textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
    clearResult();
    message('準備できました');
  } catch (error) {
    if (version === loadVersion) message(error.message);
  } finally {
    if (version === loadVersion) { loading = false; refreshControls(); }
  }
}
function updateRecipe() {
  ui['quality-value'].value = `${ui.quality.value}%`;
  ui['rounds-value'].value = `${ui.rounds.value}回`;
  document.querySelectorAll('[data-quality]').forEach(button => {
    const selected = button.dataset.quality === ui.quality.value && button.dataset.rounds === ui.rounds.value;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}
ui.quality.addEventListener('input', updateRecipe);
ui.rounds.addEventListener('input', updateRecipe);
document.querySelectorAll('[data-quality]').forEach(button => button.addEventListener('click', () => {
  ui.quality.value = button.dataset.quality;
  ui.rounds.value = button.dataset.rounds;
  updateRecipe();
}));
ui.file.addEventListener('change', () => { loadFile(ui.file.files[0]); ui.file.value = ''; });
for (const event of ['dragenter', 'dragover']) ui.dropzone.addEventListener(event, e => {
  e.preventDefault();
  if (!busy) ui.dropzone.classList.add('dragging');
});
for (const event of ['dragleave', 'drop']) ui.dropzone.addEventListener(event, e => {
  e.preventDefault();
  ui.dropzone.classList.remove('dragging');
  if (event === 'drop') loadFile(e.dataTransfer.files[0]);
});
// Prevent a dropped file outside the target from navigating away from the app.
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());
ui.download.addEventListener('click', event => { if (!resultURL) event.preventDefault(); });
ui.cancel.addEventListener('click', () => { cancelled = true; ui.cancel.disabled = true; message('中止しています…'); });

function publishResult(blob, completed, width, height, quality) {
  if (resultURL) URL.revokeObjectURL(resultURL);
  resultURL = URL.createObjectURL(blob);
  ui.after.src = resultURL;
  ui.after.hidden = false;
  ui['after-empty'].hidden = true;
  ui['after-meta'].textContent = `${completed}回 / ${(blob.size / 1024).toFixed(1)} KB`;
  ui['result-info'].textContent = `${width} × ${height} px · 品質${quality}% · ${completed}回再保存`;
  ui.download.href = resultURL;
  ui.download.download = `${sourceName}-gabigabi-${completed}.jpg`;
  ui.download.classList.remove('disabled');
  ui.download.setAttribute('aria-disabled', 'false');
}
ui.run.addEventListener('click', async () => {
  if (busy || loading || !source) return;
  busy = true;
  cancelled = false;
  ui.cancel.disabled = false;
  clearResult();
  refreshControls();
  const count = Number(ui.rounds.value);
  const quality = Number(ui.quality.value);
  const vary = ui.variation.checked;
  const limit = Number(ui.size.value);
  const scale = Math.min(1, limit / Math.max(source.naturalWidth, source.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
  const ctx = canvas.getContext('2d', { alpha: false });
  let completed = 0;
  let lastBlob = null;
  ui.progress.max = count;
  try {
    if (!ctx) throw new Error('このブラウザでは画像処理を利用できません。');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    for (let i = 0; i < count && !cancelled; i++) {
      // Each generation starts from the decoded JPEG of the previous generation.
      // Varying quality avoids the early fixed point of repeated identical encodes.
      const offset = vary && i < count - 1 ? [0, 4, -3, 6, -5, 2, -1][i % 7] : 0;
      const actualQuality = Math.max(1, Math.min(95, quality + offset)) / 100;
      lastBlob = await blobFromCanvas(canvas, actualQuality);
      const nextImage = await decode(lastBlob);
      ctx.drawImage(nextImage, 0, 0);
      completed = i + 1;
      ui.progress.value = completed;
      ui.counter.textContent = `${completed} / ${count}`;
      if (completed % 10 === 0 || completed === count) {
        publishResult(lastBlob, completed, canvas.width, canvas.height, quality);
      }
      if (completed % 5 === 0) {
        message(`${completed}回目を再保存中…`);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    if (lastBlob) publishResult(lastBlob, completed, canvas.width, canvas.height, quality);
    message(cancelled ? `${completed}回で中止しました` : `${completed}回の再保存が完了`);
  } catch (error) {
    message(error.message || '処理に失敗しました。小さな画像で試してください。');
  } finally {
    canvas.width = canvas.height = 1;
    busy = false;
    refreshControls();
  }
});

ui.demo.addEventListener('click', async () => {
  if (busy) return;
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 1100;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 900, 1100);
  gradient.addColorStop(0, '#f4afc5');
  gradient.addColorStop(.48, '#ed5a41');
  gradient.addColorStop(1, '#4940ad');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 900, 1100);
  ctx.fillStyle = '#f5e846';
  ctx.beginPath(); ctx.arc(450, 490, 260, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#22223b'; ctx.lineWidth = 13;
  for (let i = 0; i < 20; i++) {
    ctx.beginPath(); ctx.ellipse(450, 490, 260, 15 + i * 12, -.35, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = '#fff9e5'; ctx.font = 'bold 100px Arial';
  ctx.fillText('GOOD', 60, 145); ctx.fillText('BYE,', 60, 255);
  ctx.font = 'bold 90px Arial'; ctx.fillText('QUALITY.', 60, 1020);
  ctx.font = '24px monospace'; ctx.fillText('GABIGABI / JPEG RE-SAVE STUDY', 60, 850);
  for (let i = 0; i < 28; i++) { ctx.fillStyle = i % 2 ? '#22223b' : '#fff9e5'; ctx.fillRect(60 + i * 28, 885, 28, 20); }
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (blob) await loadFile(new File([blob], 'sample.png', { type: 'image/png' }));
});
updateRecipe();
