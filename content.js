'use strict';

(function () {
  if (window.__ecomImgExtractorLoaded) return;
  window.__ecomImgExtractorLoaded = true;

  const BUTTON_ID = 'ecom-img-extractor-btn';
  const STYLE_ID = 'ecom-img-extractor-style';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${BUTTON_ID} {
        position: fixed;
        right: 24px;
        bottom: 60px;
        z-index: 2147483647;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 12px 22px;
        font-size: 15px;
        font-weight: 600;
        line-height: 1;
        color: #ffffff;
        background: linear-gradient(135deg, #5b8cff, #2f6bff);
        border: none;
        border-radius: 24px;
        box-shadow: 0 6px 18px rgba(47, 107, 255, 0.42);
        cursor: pointer;
        user-select: none;
        transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      }
      #${BUTTON_ID}:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 26px rgba(47, 107, 255, 0.52);
      }
      #${BUTTON_ID}:active {
        transform: translateY(0);
      }
      #${BUTTON_ID}:disabled {
        opacity: 0.7;
        cursor: progress;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function createButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.textContent = '获取图片';
    btn.title = '提取本页所有商品图片';
    btn.addEventListener('click', onButtonClick);
    document.body.appendChild(btn);
  }

  async function onButtonClick(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '提取中…';
    try {
      await scrollToLoadLazyImages();
      const images = extractImages();
      if (!images || images.length === 0) {
        showToast('未提取到图片，请稍后重试');
        return;
      }
      const pageInfo = {
        platform: detectPlatform(),
        title: document.title || '',
        url: location.href,
      };
      await chrome.storage.local.set({ pendingImages: images, pendingPageInfo: pageInfo });
      try {
        await chrome.runtime.sendMessage({ type: 'OPEN_VIEWER' });
      } catch (err) {
        console.warn('[电商图片提取] 打开预览页失败（图片已保存，可点击插件图标查看）', err);
      }
    } catch (err) {
      console.error('[电商图片提取] 提取失败', err);
      showToast('提取失败：' + (err && err.message ? err.message : '未知错误'));
    } finally {
      btn.disabled = false;
      btn.textContent = '获取图片';
    }
  }

  // 通过滚动触发懒加载，尽量加载出页面中尚未渲染的图片。
  // 部分详情页会随滚动动态增高，因此循环检测页面高度，直到高度稳定。
  async function scrollToLoadLazyImages() {
    const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
    const startY = window.scrollY;
    let y = 0;
    let prevHeight = -1;
    let stable = 0;
    for (let i = 0; i < 80; i++) {
      const total = document.documentElement.scrollHeight;
      window.scrollTo(0, y);
      await sleep(150);
      if (total === prevHeight) {
        stable += 1;
      } else {
        stable = 0;
      }
      prevHeight = total;
      y += step;
      if (y >= total && stable >= 2) break;
    }
    window.scrollTo(0, startY);
    await sleep(300);
  }

  function detectPlatform() {
    const host = location.hostname;
    if (host.includes('taobao.com') || host.includes('tmall.com')) return '淘宝';
    if (host.includes('jd.com')) return '京东';
    if (host.includes('pinduoduo.com') || host.includes('yangkeduo.com')) return '拼多多';
    return '电商';
  }

  function normalizeUrl(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let u = raw.trim();
    if (!u) return null;
    if (/^(data:|javascript:|about:|blob:|file:)/i.test(u)) return null;
    if (u.startsWith('//')) u = 'https:' + u;
    try {
      const url = new URL(u, location.href);
      url.hash = '';
      return url.href;
    } catch (e) {
      return null;
    }
  }

  function getLargestFromSrcset(srcset) {
    if (!srcset) return null;
    let bestUrl = null;
    let bestScore = -1;
    srcset.split(',').forEach((part) => {
      const seg = part.trim().split(/\s+/);
      const u = seg[0];
      if (!u) return;
      let score = 0;
      const desc = seg[1];
      if (desc && desc.endsWith('w')) {
        score = parseInt(desc, 10) || 0;
      } else if (desc && desc.endsWith('x')) {
        score = (parseFloat(desc) || 1) * 1000;
      }
      if (score > bestScore) {
        bestScore = score;
        bestUrl = u;
      }
    });
    return bestUrl;
  }

  function extractImages() {
    const map = new Map();
    const SMALL = 50; // 已知尺寸小于该值时视为图标/装饰，跳过

    const add = (raw, info) => {
      const url = normalizeUrl(raw);
      if (!url) return;
      info = info || {};
      if (map.has(url)) {
        const prev = map.get(url);
        if (info.w && (!prev.w || info.w > prev.w)) {
          prev.w = info.w;
          prev.h = info.h;
        }
      } else {
        map.set(url, { url, w: info.w || 0, h: info.h || 0 });
      }
    };

    // 1) 常规 <img> 元素（含懒加载、srcset 高清图）
    document.querySelectorAll('img').forEach((img) => {
      const w = img.naturalWidth || parseInt(img.getAttribute('width'), 10) || 0;
      const h = img.naturalHeight || parseInt(img.getAttribute('height'), 10) || 0;
      const info = { w, h };

      if (w && h && w < SMALL && h < SMALL) return;

      const lazyAttrs = [
        'data-src',
        'data-original',
        'data-lazy-src',
        'data-lazyload',
        'data-echo',
        'data-img',
        'data-ks-lazyload',
      ];
      let lazyUrl = null;
      for (const attr of lazyAttrs) {
        const v = img.getAttribute(attr);
        if (v && v.trim()) {
          lazyUrl = v;
          break;
        }
      }

      const srcsetLargest = getLargestFromSrcset(
        img.getAttribute('srcset') || img.getAttribute('data-srcset')
      );

      if (srcsetLargest) add(srcsetLargest, info);
      else if (lazyUrl) add(lazyUrl, info);
      else if (img.currentSrc || img.src) add(img.currentSrc || img.src, info);
    });

    // 2) CSS 背景图
    document.querySelectorAll('*').forEach((el) => {
      let bg;
      try {
        bg = getComputedStyle(el).backgroundImage;
      } catch (e) {
        return;
      }
      if (!bg || bg === 'none') return;
      const re = /url\((["']?)(.*?)\1\)/g;
      let m;
      while ((m = re.exec(bg)) !== null) {
        add(m[2]);
      }
    });

    // 3) 指向大图的链接（部分平台用 <a> 包裹原图）
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (href && /\.(jpe?g|png|webp|gif|bmp)(\?|#|$)/i.test(href)) {
        add(href);
      }
    });

    return Array.from(map.values());
  }

  function showToast(msg) {
    const id = 'ecom-img-extractor-toast';
    let toast = document.getElementById(id);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = id;
      toast.style.cssText =
        'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483647;' +
        'background:rgba(0,0,0,0.78);color:#fff;padding:12px 22px;border-radius:8px;' +
        'font-size:14px;line-height:1.4;max-width:70vw;text-align:center;' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.display = 'block';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      toast.style.display = 'none';
    }, 2500);
  }

  function init() {
    injectStyle();
    createButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
