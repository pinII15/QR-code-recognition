const LAST_SCAN_TASK_KEY = 'lastScanTask';
const LAST_RESULT_KEY = 'lastResult';
const URL_PATTERN = /^https?:\/\//i;

const hasChromeApi = typeof chrome !== 'undefined' && chrome.runtime && chrome.storage;

const captureButton = document.getElementById('captureButton');
const statusElement = document.getElementById('status');
const decodedTextElement = document.getElementById('decodedText');
const linkContainer = document.getElementById('linkContainer');
const resultLink = document.getElementById('resultLink');
const sourceMode = document.getElementById('sourceMode');
const sourceTitle = document.getElementById('sourceTitle');
const sourceUrl = document.getElementById('sourceUrl');
const imageMetaRow = document.getElementById('imageMetaRow');
const imageUrl = document.getElementById('imageUrl');
const triggeredAt = document.getElementById('triggeredAt');

captureButton.addEventListener('click', async () => {
  if (!hasChromeApi) {
    setStatus('请在 Chrome 扩展环境中使用截图识别功能。');
    return;
  }

  captureButton.disabled = true;
  captureButton.textContent = '截图中...';
  setStatus('正在截图并识别二维码...');

  try {
    const response = await chrome.runtime.sendMessage({ type: 'capture-and-decode' });
    if (!response?.ok) {
      throw new Error(response?.message || '操作失败，请重试。');
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '操作失败，请重试。', 'error');
  } finally {
    captureButton.disabled = false;
    captureButton.textContent = '重新截图识别';
  }
});

if (hasChromeApi) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }

    if (changes[LAST_RESULT_KEY]) {
      renderResult(changes[LAST_RESULT_KEY].newValue);
    }

    if (changes[LAST_SCAN_TASK_KEY]?.newValue) {
      decodeTask(changes[LAST_SCAN_TASK_KEY].newValue).catch((error) => {
        setStatus(error instanceof Error ? error.message : '识别失败，请重试。', 'error');
      });
    }
  });
}

init().catch((error) => {
  setStatus(error instanceof Error ? error.message : '加载结果失败。', 'error');
});

async function init() {
  if (!hasChromeApi) {
    renderResult();
    setStatus('当前为页面预览模式，请在 Chrome 扩展中触发扫码。');
    captureButton.disabled = true;
    return;
  }

  const storage = await chrome.storage.local.get([LAST_SCAN_TASK_KEY, LAST_RESULT_KEY]);
  renderResult(storage[LAST_RESULT_KEY]);

  if (storage[LAST_SCAN_TASK_KEY] && shouldDecode(storage[LAST_SCAN_TASK_KEY], storage[LAST_RESULT_KEY])) {
    await decodeTask(storage[LAST_SCAN_TASK_KEY]);
  }
}

function shouldDecode(task, result) {
  if (!task?.dataUrl) {
    return false;
  }

  if (!result) {
    return true;
  }

  return task.triggeredAt !== result.triggeredAt || result.status === 'processing';
}

async function decodeTask(task) {
  if (!('BarcodeDetector' in window)) {
    await saveResult({
      status: 'error',
      text: '',
      isUrl: false,
      sourceType: task.sourceType,
      triggeredAt: task.triggeredAt,
      sourceTab: task.sourceTab,
      imageUrl: task.imageUrl || '',
      message: '当前 Chrome 版本不支持二维码识别，请升级浏览器后重试。'
    });
    return;
  }

  const supportedFormats = await BarcodeDetector.getSupportedFormats();
  if (!supportedFormats.includes('qr_code')) {
    await saveResult({
      status: 'error',
      text: '',
      isUrl: false,
      sourceType: task.sourceType,
      triggeredAt: task.triggeredAt,
      sourceTab: task.sourceTab,
      imageUrl: task.imageUrl || '',
      message: '当前环境不支持识别二维码格式。'
    });
    return;
  }

  setStatus(task.message || '正在识别二维码...');

  const detector = new BarcodeDetector({ formats: ['qr_code'] });
  const image = await loadImage(task.dataUrl);
  const codes = await detector.detect(image);
  const text = codes[0]?.rawValue?.trim() || '';

  if (text) {
    await saveResult({
      status: 'success',
      text,
      isUrl: URL_PATTERN.test(text),
      sourceType: task.sourceType,
      triggeredAt: task.triggeredAt,
      sourceTab: task.sourceTab,
      imageUrl: task.imageUrl || ''
    });
    return;
  }

  await saveResult({
    status: 'not-found',
    text: '',
    isUrl: false,
    sourceType: task.sourceType,
    triggeredAt: task.triggeredAt,
    sourceTab: task.sourceTab,
    imageUrl: task.imageUrl || '',
    message: task.sourceType === 'image_context_menu'
      ? '所选图片中未检测到可识别的二维码。'
      : '截图中未检测到可识别的二维码。'
  });
}

async function saveResult(result) {
  await chrome.storage.local.set({ [LAST_RESULT_KEY]: result });
}

function renderResult(result) {
  if (!result) {
    decodedTextElement.value = '';
    linkContainer.classList.add('hidden');
    sourceMode.textContent = '-';
    sourceTitle.textContent = '-';
    sourceUrl.textContent = '-';
    imageUrl.textContent = '-';
    imageMetaRow.classList.add('hidden');
    triggeredAt.textContent = '-';
    setStatus('请点击插件图标、使用快捷键，或在图片上右键开始扫码。');
    return;
  }

  decodedTextElement.value = result.text || '';
  sourceMode.textContent = getSourceLabel(result.sourceType);
  sourceTitle.textContent = result.sourceTab?.title || '-';
  sourceUrl.textContent = result.sourceTab?.url || '-';
  triggeredAt.textContent = formatDate(result.triggeredAt);

  if (result.sourceType === 'image_context_menu' && result.imageUrl) {
    imageUrl.textContent = result.imageUrl;
    imageMetaRow.classList.remove('hidden');
  } else {
    imageUrl.textContent = '-';
    imageMetaRow.classList.add('hidden');
  }

  if (result.isUrl && result.text) {
    resultLink.href = result.text;
    resultLink.textContent = `打开：${result.text}`;
    linkContainer.classList.remove('hidden');
  } else {
    resultLink.removeAttribute('href');
    linkContainer.classList.add('hidden');
  }

  if (result.status === 'success') {
    setStatus('已成功识别二维码内容。', 'success');
  } else if (result.status === 'processing') {
    setStatus(result.message || '正在识别二维码...');
  } else if (result.status === 'not-found') {
    setStatus(result.message || '未检测到二维码。');
  } else {
    setStatus(result.message || '识别失败，请重试。', 'error');
  }
}

function setStatus(message, tone = 'info') {
  statusElement.textContent = message;
  statusElement.className = `status${tone === 'info' ? '' : ` ${tone}`}`;
}

function getSourceLabel(sourceType) {
  if (sourceType === 'image_context_menu') {
    return '右键图片扫码';
  }

  if (sourceType === 'page_capture') {
    return '页面截图';
  }

  return '-';
}

function formatDate(value) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(date);
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法读取待识别图片内容。'));
    image.src = dataUrl;
  });
}
