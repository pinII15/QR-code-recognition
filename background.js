const LAST_CAPTURE_KEY = 'lastCapture';
const LAST_RESULT_KEY = 'lastResult';
const RESULT_PAGE = 'results.html';

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
  const capturedAt = new Date().toISOString();

  if (!tab || typeof tab.windowId !== 'number') {
    throw new Error('未找到当前标签页。');
  }

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const capture = {
      dataUrl,
      capturedAt,
      sourceTab: {
        id: tab.id,
        title: tab.title || '',
        url: tab.url || ''
      }
    };

    await chrome.storage.local.set({
      [LAST_CAPTURE_KEY]: capture,
      [LAST_RESULT_KEY]: {
        status: 'processing',
        text: '',
        isUrl: false,
        message: '正在识别截图中的二维码...',
        capturedAt,
        sourceTab: capture.sourceTab
      }
    });

    await openResultsPage(focusResultsPage);
  } catch (error) {
    const message = error instanceof Error ? error.message : '截图失败，请重试。';
    await chrome.storage.local.set({
      [LAST_RESULT_KEY]: {
        status: 'error',
        text: '',
        isUrl: false,
        message,
        capturedAt,
        sourceTab: {
          id: tab.id,
          title: tab.title || '',
          url: tab.url || ''
        }
      }
    });

    await openResultsPage(focusResultsPage);
    throw error;
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
