'use strict';

(function () {
  const grid = document.getElementById('grid');
  const stats = document.getElementById('stats');
  const pageSubtitle = document.getElementById('page-subtitle');
  const empty = document.getElementById('empty');
  const progress = document.getElementById('progress');
  const progressInner = document.getElementById('progress-inner');
  const progressText = document.getElementById('progress-text');
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const toastEl = document.getElementById('toast');

  const btnSelectAll = document.getElementById('btn-select-all');
  const btnInvert = document.getElementById('btn-invert');
  const btnClear = document.getElementById('btn-clear');
  const btnDownload = document.getElementById('btn-download');

  let images = []; // { url, w, h }
  let pageInfo = {}; // { platform, title, url }
  let selected = new Set(); // 下标集合

  init();

  async function init() {
    try {
      const data = await chrome.storage.local.get(['pendingImages', 'pendingPageInfo']);
      pageInfo = data.pendingPageInfo || {};
      images = (data.pendingImages || []).filter((it) => it && it.url);
    } catch (err) {
      console.warn('读取存储失败', err);
      images = [];
    }

    if (pageInfo.platform || pageInfo.title) {
      pageSubtitle.textContent = [pageInfo.platform, pageInfo.title].filter(Boolean).join(' · ');
    }

    if (images.length === 0) {
      empty.classList.remove('hidden');
      grid.classList.add('hidden');
    } else {
      empty.classList.add('hidden');
      grid.classList.remove('hidden');
      renderGrid();
      updateStats();
    }

    bindToolbar();
  }

  function renderGrid() {
    grid.innerHTML = '';
    const frag = document.createDocumentFragment();
    images.forEach((img, i) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.index = String(i);

      const check = document.createElement('div');
      check.className = 'check';
      check.textContent = '✓';

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'thumb-wrap';

      const thumb = document.createElement('img');
      thumb.className = 'thumb';
      thumb.loading = 'lazy';
      thumb.referrerPolicy = 'no-referrer';
      thumb.alt = '图片 ' + (i + 1);
      thumb.src = img.url;
      thumb.addEventListener('load', () => {
        if (!img.w) img.w = thumb.naturalWidth;
        if (!img.h) img.h = thumb.naturalHeight;
        updateMeta(card, img);
      });

      const dlSingle = document.createElement('button');
      dlSingle.className = 'dl-single';
      dlSingle.textContent = '下载';

      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = img.w && img.h ? `${img.w} × ${img.h}` : '加载中…';

      thumbWrap.appendChild(thumb);
      thumbWrap.appendChild(check);
      thumbWrap.appendChild(dlSingle);
      card.appendChild(thumbWrap);
      card.appendChild(meta);
      frag.appendChild(card);
    });
    grid.appendChild(frag);
  }

  function updateMeta(card, img) {
    const meta = card.querySelector('.meta');
    if (meta && img.w && img.h) {
      meta.textContent = `${img.w} × ${img.h}`;
    }
  }

  function updateStats() {
    stats.textContent = `共 ${images.length} 张 · 已选 ${selected.size} 张`;
    btnDownload.disabled = selected.size === 0;
  }

  function setCardSelected(card, i, on) {
    card.classList.toggle('selected', on);
    if (on) selected.add(i);
    else selected.delete(i);
    updateStats();
  }

  function toggleSelect(i) {
    const card = grid.querySelector(`.card[data-index="${i}"]`);
    if (!card) return;
    const on = !selected.has(i);
    setCardSelected(card, i, on);
  }

  function bindToolbar() {
    btnSelectAll.addEventListener('click', () => {
      images.forEach((_, i) => {
        const card = grid.querySelector(`.card[data-index="${i}"]`);
        if (card) setCardSelected(card, i, true);
      });
    });

    btnInvert.addEventListener('click', () => {
      images.forEach((_, i) => toggleSelect(i));
    });

    btnClear.addEventListener('click', () => {
      images.forEach((_, i) => {
        const card = grid.querySelector(`.card[data-index="${i}"]`);
        if (card) setCardSelected(card, i, false);
      });
    });

    btnDownload.addEventListener('click', () => {
      const indices = Array.from(selected).sort((a, b) => a - b);
      downloadImages(indices);
    });

    grid.addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      const i = Number(card.dataset.index);
      if (e.target.closest('.check')) {
        toggleSelect(i);
      } else if (e.target.closest('.dl-single')) {
        downloadImages([i]);
      } else if (e.target.closest('.thumb')) {
        openLightbox(images[i].url);
      }
    });

    document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) closeLightbox();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeLightbox();
    });
  }

  function openLightbox(url) {
    lightboxImg.src = url;
    lightbox.classList.remove('hidden');
  }

  function closeLightbox() {
    lightbox.classList.add('hidden');
    lightboxImg.src = '';
  }

  function showProgress(on, text) {
    if (on) {
      progress.classList.remove('hidden');
      progressText.textContent = text || '';
    } else {
      progress.classList.add('hidden');
    }
  }

  function setProgress(pct, text) {
    progressInner.style.width = Math.round(pct * 100) + '%';
    progressText.textContent = text || '';
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.add('hidden'), 3200);
  }

  async function downloadImages(indices) {
    if (!indices.length) {
      showToast('请先选择要下载的图片');
      return;
    }

    setBusy(true);
    showProgress(true, '准备下载…');

    let ok = 0;
    let fail = 0;
    const total = indices.length;

    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      const item = images[i];
      setProgress((k + 1) / total, `正在处理 ${k + 1} / ${total}`);
      try {
        const pngBlob = await fetchAndConvert(item);
        const filename = buildFilename(i, k + 1);
        await savePng(pngBlob, filename);
        ok++;
      } catch (err) {
        console.warn('下载失败', item.url, err);
        fail++;
      }
    }

    showProgress(false);
    setBusy(false);
    showToast(`下载完成：成功 ${ok} 张${fail ? `，失败 ${fail} 张` : ''}`);
  }

  function setBusy(busy) {
    btnDownload.disabled = busy || selected.size === 0;
    btnDownload.textContent = busy ? '下载中…' : '下载所选图片';
    btnSelectAll.disabled = busy;
    btnInvert.disabled = busy;
    btnClear.disabled = busy;
  }

  async function fetchAndConvert(item) {
    const resp = await fetch(item.url, { credentials: 'omit' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const blob = await resp.blob();
    return convertToPng(blob);
  }

  function convertToPng(blob) {
    return new Promise((resolve, reject) => {
      const objUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        const MAX = 32000;
        if (w > MAX || h > MAX) {
          const scale = Math.min(MAX / w, MAX / h);
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
        }
        let canvas;
        try {
          canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
        } catch (err) {
          URL.revokeObjectURL(objUrl);
          reject(new Error('图片过大，无法转换'));
          return;
        }
        canvas.toBlob((pngBlob) => {
          URL.revokeObjectURL(objUrl);
          if (pngBlob) resolve(pngBlob);
          else reject(new Error('PNG 编码失败'));
        }, 'image/png');
      };
      img.onerror = () => {
        URL.revokeObjectURL(objUrl);
        reject(new Error('图片加载失败'));
      };
      img.src = objUrl;
    });
  }

  function sanitizeName(s) {
    return String(s || '')
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function buildFilename(index, order) {
    const platform = sanitizeName(pageInfo.platform) || '电商';
    let title = sanitizeName(pageInfo.title) || '图片';
    if (title.length > 16) title = title.slice(0, 16);
    const no = String(order).padStart(3, '0');
    return `${platform}_${title}_${no}.png`;
  }

  function savePng(blob, filename) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const cleanup = () => setTimeout(() => URL.revokeObjectURL(url), 30000);

      if (chrome.downloads && chrome.downloads.download) {
        chrome.downloads.download(
          { url, filename: '电商图片/' + filename, conflictAction: 'uniquify' },
          (downloadId) => {
            if (chrome.runtime.lastError || downloadId == null) {
              anchorDownload(url, filename).then(resolve).catch(reject);
            } else {
              cleanup();
              resolve();
            }
          }
        );
      } else {
        anchorDownload(url, filename).then(resolve).catch(reject);
      }
    });
  }

  function anchorDownload(url, filename) {
    return new Promise((resolve) => {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => resolve(), 200);
    });
  }
})();
