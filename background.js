'use strict';

// Service Worker：负责打开/复用预览页面。
const VIEWER_URL = chrome.runtime.getURL('viewer.html');
let viewerTabId = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === 'OPEN_VIEWER') {
    openViewer();
    sendResponse({ ok: true });
  }
  return false;
});

// 点击工具栏图标时，打开最近一次提取结果。
chrome.action.onClicked.addListener(() => {
  openViewer();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === viewerTabId) viewerTabId = null;
});

function openViewer() {
  if (viewerTabId !== null) {
    chrome.tabs.get(viewerTabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        viewerTabId = null;
        createViewer();
      } else {
        chrome.windows.update(tab.windowId, { focused: true }, () => {
          chrome.tabs.update(viewerTabId, { active: true });
          chrome.tabs.reload(viewerTabId);
        });
      }
    });
  } else {
    createViewer();
  }
}

function createViewer() {
  chrome.tabs.create({ url: VIEWER_URL }, (tab) => {
    if (tab) viewerTabId = tab.id;
  });
}
