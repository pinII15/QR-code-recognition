const LAST_SCAN_TASK_KEY = 'lastScanTask';
const LAST_RESULT_KEY = 'lastResult';
const RESULT_PAGE = 'results.html';
const IMAGE_SCAN_MENU_ID = 'scan-image-qr';

chrome.runtime.onInstalled.addListener(() => {
  registerContextMenu().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  registerContextMenu().catch(() => {});
});

chrome.action.onClicked.addListener(async (tab) => {
  await captureAndShow(tab);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'capture-and-decode') {
    return;
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await captureAndShow(activeTab);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== IMAGE_SCAN_MENU_ID) {
    return;
  }

  await scanImageAndShow(info, tab);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'capture-and-decode') {
    return false;
  }

  chrome.tabs
    .query({ active: true, currentWindow: true })
    .then(([activeTab]) => captureAndShow(activeTab, false))
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      sendResponse({ ok: false, message: error instanceof Error ? error.message : '截图失败，请重试。' });
    });

  return true;
});

async function captureAndShow(tab, focusResultsPage = true) {
  const triggeredAt = new Date().toISOString();

  if (!tab || typeof tab.windowId !== 'number') {
    throw new Error('未找到当前标签页。');
  }

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const task = {
      sourceType: 'page_capture',
      dataUrl,
      triggeredAt,
      sourceTab: buildSourceTab(tab),
      message: '正在识别截图中的二维码...'
    };

    await savePendingTask(task);
    await openResultsPage(focusResultsPage);
  } catch (error) {
    const message = error instanceof Error ? error.message : '截图失败，请重试。';
    await saveErrorResult({
      sourceType: 'page_capture',
      triggeredAt,
      sourceTab: buildSourceTab(tab),
      message
    });
    await openResultsPage(focusResultsPage);
    throw error;
  }
}

async function scanImageAndShow(info, tab) {
  const triggeredAt = new Date().toISOString();
  const sourceTab = buildSourceTab(tab);
  const imageUrl = info.srcUrl || '';

  if (!imageUrl) {
    await saveErrorResult({
      sourceType: 'image_context_menu',
      triggeredAt,
      sourceTab,
      imageUrl,
      message: '未找到可识别的图片地址，请在网页图片上重试。'
    });
    await openResultsPage(true);
    return;
  }

  try {
    const dataUrl = await getImageDataUrl(imageUrl);
    await savePendingTask({
      sourceType: 'image_context_menu',
      dataUrl,
      triggeredAt,
      sourceTab,
      imageUrl,
      message: '正在识别所选图片中的二维码...'
    });
    await openResultsPage(true);
  } catch (error) {
    await saveErrorResult({
      sourceType: 'image_context_menu',
      triggeredAt,
      sourceTab,
      imageUrl,
      message: error instanceof Error ? error.message : '读取图片失败，请重试。'
    });
    await openResultsPage(true);
  }
}

async function openResultsPage(focus = true) {
  const url = chrome.runtime.getURL(RESULT_PAGE);
  const [existingTab] = await chrome.tabs.query({ url });

  if (existingTab?.id) {
    await chrome.tabs.update(existingTab.id, { active: focus });
    return;
  }

  await chrome.tabs.create({ url, active: focus });
}

async function registerContextMenu() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: IMAGE_SCAN_MENU_ID,
    title: '识别这张图片中的二维码',
    contexts: ['image']
  });
}

async function savePendingTask(task) {
  await chrome.storage.local.set({
    [LAST_SCAN_TASK_KEY]: task,
    [LAST_RESULT_KEY]: {
      status: 'processing',
      text: '',
      isUrl: false,
      message: task.message,
      sourceType: task.sourceType,
      triggeredAt: task.triggeredAt,
      sourceTab: task.sourceTab,
      imageUrl: task.imageUrl || ''
    }
  });
}

async function saveErrorResult(result) {
  await chrome.storage.local.set({
    [LAST_SCAN_TASK_KEY]: null,
    [LAST_RESULT_KEY]: {
      status: 'error',
      text: '',
      isUrl: false,
      sourceType: result.sourceType,
      triggeredAt: result.triggeredAt,
      sourceTab: result.sourceTab,
      imageUrl: result.imageUrl || '',
      message: result.message
    }
  });
}

function buildSourceTab(tab) {
  return {
    id: tab?.id,
    title: tab?.title || '',
    url: tab?.url || ''
  };
}

async function getImageDataUrl(imageUrl) {
  if (imageUrl.startsWith('data:')) {
    return imageUrl;
  }

  if (imageUrl.startsWith('blob:')) {
    throw new Error('暂不支持识别使用 blob 地址的图片，请直接打开图片或使用页面截图识别。');
  }

  const response = await fetch(imageUrl, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`读取图片失败（${response.status}）。`);
  }

  const blob = await response.blob();
  return blobToDataUrl(blob);
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
}
