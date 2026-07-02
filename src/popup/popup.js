(() => {
  const contentScriptFilesApi = globalThis.EasyTweetBlockContentScriptFiles
    || (typeof module !== 'undefined' && module.exports ? require('../shared/content-script-files.js') : null);

  if (!contentScriptFilesApi) {
    throw new Error('Missing Easy TweetBlock content script file config.');
  }

  const IMMEDIATE_BLOCK_MESSAGE_TYPE = 'easy-tweetblock:block-usernames-via-api';
  const POPUP_VIEWS = Object.freeze({
    main: 'main',
    settings: 'settings'
  });
  const CONTENT_SCRIPT_CSS_FILES = Object.freeze([...contentScriptFilesApi.CONTENT_SCRIPT_CSS_FILES]);
  const CONTENT_SCRIPT_FILES = Object.freeze([...contentScriptFilesApi.CONTENT_SCRIPT_FILES]);

  function normalizePopupView(view) {
    return view === POPUP_VIEWS.settings ? POPUP_VIEWS.settings : POPUP_VIEWS.main;
  }

  function setPopupView(shellElement, view) {
    if (!shellElement) {
      return normalizePopupView(view);
    }

    const normalizedView = normalizePopupView(view);
    shellElement.dataset.view = normalizedView;
    return normalizedView;
  }

  function getExtensionApi(extensionApi = globalThis.browser || globalThis.chrome) {
    return extensionApi || null;
  }

  function isSupportedTabUrl(url) {
    return typeof url === 'string'
      && (url.startsWith('https://x.com/') || url.startsWith('https://twitter.com/'));
  }

  function isMissingReceiverError(error) {
    const message = error instanceof Error ? error.message : String(error || '');

    return message.includes('Receiving end does not exist')
      || message.includes('Could not establish connection');
  }

  function queryTabs(queryInfo, extensionApi = getExtensionApi()) {
    try {
      const maybePromise = extensionApi?.tabs?.query?.(queryInfo);

      if (maybePromise && typeof maybePromise.then === 'function') {
        return maybePromise;
      }
    } catch {
      // Fall through to callback mode.
    }

    return new Promise((resolve, reject) => {
      extensionApi.tabs.query(queryInfo, (tabs) => {
        const lastError = extensionApi.runtime?.lastError;

        if (lastError) {
          reject(new Error(lastError.message || String(lastError)));
          return;
        }

        resolve(tabs || []);
      });
    });
  }

  function sendTabMessage(tabId, message, extensionApi = getExtensionApi()) {
    try {
      const maybePromise = extensionApi?.tabs?.sendMessage?.(tabId, message);

      if (maybePromise && typeof maybePromise.then === 'function') {
        return maybePromise;
      }
    } catch {
      // Fall through to callback mode.
    }

    return new Promise((resolve, reject) => {
      extensionApi.tabs.sendMessage(tabId, message, (response) => {
        const lastError = extensionApi.runtime?.lastError;

        if (lastError) {
          reject(new Error(lastError.message || String(lastError)));
          return;
        }

        resolve(response);
      });
    });
  }

  function executeTabFunction(tabId, func, args = [], extensionApi = getExtensionApi()) {
    if (!extensionApi?.scripting?.executeScript) {
      return Promise.reject(new Error('This browser does not support scripting.executeScript for direct tab execution.'));
    }

    try {
      const maybePromise = extensionApi.scripting.executeScript({
        args,
        func,
        target: { tabId }
      });

      if (maybePromise && typeof maybePromise.then === 'function') {
        return maybePromise;
      }
    } catch {
      // Fall through to callback mode.
    }

    return new Promise((resolve, reject) => {
      extensionApi.scripting.executeScript({
        args,
        func,
        target: { tabId }
      }, (result) => {
        const lastError = extensionApi.runtime?.lastError;

        if (lastError) {
          reject(new Error(lastError.message || String(lastError)));
          return;
        }

        resolve(result || []);
      });
    });
  }

  async function executeScriptsWithLegacyTabs(tabId, files, extensionApi) {
    for (const file of files) {
      try {
        const maybePromise = extensionApi.tabs.executeScript(tabId, { file });

        if (maybePromise && typeof maybePromise.then === 'function') {
          await maybePromise;
          continue;
        }
      } catch {
        // Fall through to callback mode.
      }

      await new Promise((resolve, reject) => {
        extensionApi.tabs.executeScript(tabId, { file }, () => {
          const lastError = extensionApi.runtime?.lastError;

          if (lastError) {
            reject(new Error(lastError.message || String(lastError)));
            return;
          }

          resolve();
        });
      });
    }
  }

  async function insertCssWithLegacyTabs(tabId, files, extensionApi) {
    for (const file of files) {
      try {
        const maybePromise = extensionApi.tabs.insertCSS(tabId, { file });

        if (maybePromise && typeof maybePromise.then === 'function') {
          await maybePromise;
          continue;
        }
      } catch {
        // Fall through to callback mode.
      }

      await new Promise((resolve, reject) => {
        extensionApi.tabs.insertCSS(tabId, { file }, () => {
          const lastError = extensionApi.runtime?.lastError;

          if (lastError) {
            reject(new Error(lastError.message || String(lastError)));
            return;
          }

          resolve();
        });
      });
    }
  }

  function insertCssWithScripting(tabId, files, extensionApi) {
    try {
      const maybePromise = extensionApi?.scripting?.insertCSS?.({
        files,
        target: { tabId }
      });

      if (maybePromise && typeof maybePromise.then === 'function') {
        return maybePromise;
      }
    } catch {
      // Fall through to callback mode.
    }

    return new Promise((resolve, reject) => {
      extensionApi.scripting.insertCSS({
        files,
        target: { tabId }
      }, () => {
        const lastError = extensionApi.runtime?.lastError;

        if (lastError) {
          reject(new Error(lastError.message || String(lastError)));
          return;
        }

        resolve();
      });
    });
  }

  async function ensureContentStylesInTab(tabId, extensionApi = getExtensionApi(), files = CONTENT_SCRIPT_CSS_FILES) {
    if (!Array.isArray(files) || !files.length) {
      return;
    }

    if (extensionApi?.scripting?.insertCSS) {
      await insertCssWithScripting(tabId, files, extensionApi);
      return;
    }

    if (extensionApi?.tabs?.insertCSS) {
      await insertCssWithLegacyTabs(tabId, files, extensionApi);
    }
  }

  function executeScriptsWithScripting(tabId, files, extensionApi) {
    try {
      const maybePromise = extensionApi?.scripting?.executeScript?.({
        files,
        target: { tabId }
      });

      if (maybePromise && typeof maybePromise.then === 'function') {
        return maybePromise;
      }
    } catch {
      // Fall through to callback mode.
    }

    return new Promise((resolve, reject) => {
      extensionApi.scripting.executeScript({
        files,
        target: { tabId }
      }, (result) => {
        const lastError = extensionApi.runtime?.lastError;

        if (lastError) {
          reject(new Error(lastError.message || String(lastError)));
          return;
        }

        resolve(result);
      });
    });
  }

  async function ensureContentScriptsInTab(tabId, extensionApi = getExtensionApi(), files = CONTENT_SCRIPT_FILES, cssFiles = CONTENT_SCRIPT_CSS_FILES) {
    await ensureContentStylesInTab(tabId, extensionApi, cssFiles);

    if (extensionApi?.scripting?.executeScript) {
      await executeScriptsWithScripting(tabId, files, extensionApi);
      return;
    }

    if (extensionApi?.tabs?.executeScript) {
      await executeScriptsWithLegacyTabs(tabId, files, extensionApi);
      return;
    }

    throw new Error('This browser does not expose a script injection API for the selected tab. Reload the X tab and retry.');
  }

  async function invokeImmediateBlockInTab(tabId, usernames, delayMs, extensionApi = getExtensionApi()) {
    const results = await executeTabFunction(
      tabId,
      async (requestedUsernames, requestedDelayMs) => {
        if (typeof globalThis.EasyTweetBlockRunImmediateBlock !== 'function') {
          throw new Error('Easy TweetBlock immediate block runner is not available in this tab.');
        }

        return globalThis.EasyTweetBlockRunImmediateBlock(requestedUsernames, requestedDelayMs);
      },
      [usernames, delayMs],
      extensionApi
    );
    const firstResult = Array.isArray(results) ? results[0] : null;

    return {
      ok: true,
      results: firstResult?.result || []
    };
  }

  async function requestImmediateBlock(tabId, usernames, delayMs, extensionApi = getExtensionApi()) {
    try {
      return await sendTabMessage(tabId, {
        delayMs,
        type: IMMEDIATE_BLOCK_MESSAGE_TYPE,
        usernames
      }, extensionApi);
    } catch (error) {
      if (!isMissingReceiverError(error)) {
        throw error;
      }

      await ensureContentScriptsInTab(tabId, extensionApi);

      return invokeImmediateBlockInTab(tabId, usernames, delayMs, extensionApi);
    }
  }

  async function findUsableXTab(extensionApi = getExtensionApi()) {
    const activeTabs = await queryTabs({ active: true, currentWindow: true }, extensionApi);
    const activeTab = activeTabs.find((tab) => isSupportedTabUrl(tab?.url));

    if (activeTab?.id != null) {
      return activeTab;
    }

    const xTabs = await queryTabs({ url: ['https://x.com/*', 'https://twitter.com/*'] }, extensionApi);
    return xTabs.find((tab) => tab?.id != null && isSupportedTabUrl(tab?.url)) || null;
  }

  function init(documentRef = document, extensionApi = getExtensionApi(), blocklist = globalThis.EasyTweetBlockBlocklist) {
    const shellElement = documentRef.getElementById('popup-shell');
    const statusElement = documentRef.getElementById('status');
    const textareaElement = documentRef.getElementById('username-blocklist');
    const delayInputElement = documentRef.getElementById('batch-block-delay-ms');
    const pageButtonStyleIconElement = documentRef.getElementById('page-button-style-icon');
    const pageButtonStyleTextElement = documentRef.getElementById('page-button-style-text');
    const openSettingsButton = documentRef.getElementById('open-settings');
    const backToMainButton = documentRef.getElementById('back-to-main');
    const saveButton = documentRef.getElementById('save-blocklist');
    const saveSettingsButton = documentRef.getElementById('save-settings');
    const blockNowButton = documentRef.getElementById('block-now');
    const countElement = documentRef.getElementById('username-count');

    let isSaving = false;
    let isBlocking = false;
    let currentDelayMs = blocklist.DEFAULT_BATCH_BLOCK_DELAY_MS;
    let currentPageButtonStyle = blocklist.DEFAULT_PAGE_BLOCK_BUTTON_STYLE;
    let draftPageButtonStyle = currentPageButtonStyle;

    if (!blocklist || !extensionApi || !shellElement || !statusElement || !textareaElement || !delayInputElement || !pageButtonStyleIconElement || !pageButtonStyleTextElement || !openSettingsButton || !backToMainButton || !saveButton || !saveSettingsButton || !blockNowButton || !countElement) {
      return;
    }

    function setStatus(message) {
      statusElement.textContent = message;
    }

    function renderCount(usernames) {
      countElement.textContent = `${usernames.length} username${usernames.length === 1 ? '' : 's'}`;
    }

    function readDelayMs() {
      return blocklist.normalizeBatchBlockDelayMs(delayInputElement.value);
    }

    function renderDelay(delayMs) {
      delayInputElement.value = String(blocklist.normalizeBatchBlockDelayMs(delayMs));
    }

    function readPageButtonStyle() {
      return blocklist.normalizePageBlockButtonStyle(draftPageButtonStyle);
    }

    function renderPageButtonStyle(style) {
      draftPageButtonStyle = blocklist.normalizePageBlockButtonStyle(style);

      pageButtonStyleIconElement.dataset.active = String(draftPageButtonStyle === blocklist.PAGE_BLOCK_BUTTON_STYLES.icon);
      pageButtonStyleTextElement.dataset.active = String(draftPageButtonStyle === blocklist.PAGE_BLOCK_BUTTON_STYLES.text);
      pageButtonStyleIconElement.setAttribute('aria-pressed', String(draftPageButtonStyle === blocklist.PAGE_BLOCK_BUTTON_STYLES.icon));
      pageButtonStyleTextElement.setAttribute('aria-pressed', String(draftPageButtonStyle === blocklist.PAGE_BLOCK_BUTTON_STYLES.text));
    }

    function setBusyState() {
      saveButton.disabled = isSaving || isBlocking;
      blockNowButton.disabled = isSaving || isBlocking;
      saveSettingsButton.disabled = isSaving || isBlocking;
    }

    function showMainView() {
      setPopupView(shellElement, POPUP_VIEWS.main);
    }

    function showSettingsView() {
      setPopupView(shellElement, POPUP_VIEWS.settings);
    }

    async function loadBlocklist() {
      const [usernames, delayMs, pageButtonStyle] = await Promise.all([
        blocklist.getStoredUsernames(extensionApi),
        blocklist.getStoredBatchBlockDelayMs(extensionApi),
        blocklist.getStoredPageBlockButtonStyle(extensionApi)
      ]);

      textareaElement.value = blocklist.serializeUsernameText(usernames);
      renderCount(usernames);
      renderDelay(delayMs);
      currentDelayMs = delayMs;
      currentPageButtonStyle = pageButtonStyle;
      renderPageButtonStyle(pageButtonStyle);
      setStatus('Save usernames for later, or block the whole list immediately through any open X tab.');
    }

    async function saveBlocklist() {
      if (isSaving) {
        return;
      }

      const { usernames, invalidEntries } = blocklist.parseUsernameText(textareaElement.value);

      isSaving = true;
      setBusyState();
      setStatus('Saving blocklist...');

      try {
        const savedUsernames = await blocklist.setStoredUsernames(usernames, extensionApi);

        textareaElement.value = blocklist.serializeUsernameText(savedUsernames);
        renderCount(savedUsernames);

        if (invalidEntries.length) {
          setStatus(`Saved ${savedUsernames.length} usernames. Skipped invalid values: ${invalidEntries.slice(0, 3).join(', ')}`);
          return;
        }

        setStatus(`Saved ${savedUsernames.length} usernames.`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        isSaving = false;
        setBusyState();
      }
    }

    async function saveSettings() {
      if (isSaving) {
        return;
      }

      const delayMs = readDelayMs();
      const pageButtonStyle = readPageButtonStyle();

      isSaving = true;
      setBusyState();
      setStatus('Saving settings...');

      try {
        const [savedDelayMs, savedPageButtonStyle] = await Promise.all([
          blocklist.setStoredBatchBlockDelayMs(delayMs, extensionApi),
          blocklist.setStoredPageBlockButtonStyle(pageButtonStyle, extensionApi)
        ]);

        currentDelayMs = savedDelayMs;
        renderDelay(savedDelayMs);
        currentPageButtonStyle = savedPageButtonStyle;
        renderPageButtonStyle(savedPageButtonStyle);
        setStatus(`Saved settings. Delay: ${savedDelayMs} ms. Style: ${savedPageButtonStyle}.`);
        showMainView();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        isSaving = false;
        setBusyState();
      }
    }

    async function blockListedNow() {
      if (isSaving || isBlocking) {
        return;
      }

      const { usernames, invalidEntries } = blocklist.parseUsernameText(textareaElement.value);

      if (!usernames.length) {
        setStatus('Add at least one valid username before blocking.');
        return;
      }

      isBlocking = true;
      setBusyState();
      setStatus('Blocking listed usernames through the X page context...');

      try {
        const savedUsernames = await blocklist.setStoredUsernames(usernames, extensionApi);
        const targetTab = await findUsableXTab(extensionApi);

        textareaElement.value = blocklist.serializeUsernameText(savedUsernames);
        renderCount(savedUsernames);

        if (!targetTab?.id) {
          throw new Error('Open any x.com or twitter.com tab first.');
        }

        const response = await requestImmediateBlock(targetTab.id, savedUsernames, currentDelayMs, extensionApi);

        if (!response?.ok) {
          throw new Error(response?.error || 'The X page did not accept the block request.');
        }

        const results = Array.isArray(response.results) ? response.results : [];
        const successCount = results.filter((entry) => entry?.ok).length;
        const failedEntries = results.filter((entry) => !entry?.ok);

        if (failedEntries.length) {
          const failedPreview = failedEntries.slice(0, 3).map((entry) => `@${entry.username}`).join(', ');
          const invalidSuffix = invalidEntries.length ? ` Invalid: ${invalidEntries.slice(0, 3).join(', ')}.` : '';
          setStatus(`Blocked ${successCount}/${results.length} usernames with ${currentDelayMs} ms delay. Failed: ${failedPreview}.${invalidSuffix}`);
          return;
        }

        if (invalidEntries.length) {
          setStatus(`Blocked ${successCount} usernames with ${currentDelayMs} ms delay. Skipped invalid values: ${invalidEntries.slice(0, 3).join(', ')}`);
          return;
        }

        setStatus(`Blocked ${successCount} usernames with ${currentDelayMs} ms delay.`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        isBlocking = false;
        setBusyState();
      }
    }

    saveButton.addEventListener('click', () => {
      void saveBlocklist();
    });

    saveSettingsButton.addEventListener('click', () => {
      void saveSettings();
    });

    blockNowButton.addEventListener('click', () => {
      void blockListedNow();
    });

    openSettingsButton.addEventListener('click', () => {
      renderDelay(currentDelayMs);
      renderPageButtonStyle(currentPageButtonStyle);
      showSettingsView();
    });

    backToMainButton.addEventListener('click', () => {
      renderDelay(currentDelayMs);
      renderPageButtonStyle(currentPageButtonStyle);
      showMainView();
    });

    pageButtonStyleIconElement.addEventListener('click', () => {
      renderPageButtonStyle(blocklist.PAGE_BLOCK_BUTTON_STYLES.icon);
    });

    pageButtonStyleTextElement.addEventListener('click', () => {
      renderPageButtonStyle(blocklist.PAGE_BLOCK_BUTTON_STYLES.text);
    });

    delayInputElement.addEventListener('change', () => {
      renderDelay(readDelayMs());
    });

    renderPageButtonStyle(currentPageButtonStyle);
    showMainView();
    setBusyState();
    void loadBlocklist();
  }

  if (typeof module !== 'undefined') {
    module.exports = {
      CONTENT_SCRIPT_CSS_FILES,
      CONTENT_SCRIPT_FILES,
      IMMEDIATE_BLOCK_MESSAGE_TYPE,
      POPUP_VIEWS,
      ensureContentScriptsInTab,
      executeTabFunction,
      findUsableXTab,
      init,
      invokeImmediateBlockInTab,
      isMissingReceiverError,
      isSupportedTabUrl,
      normalizePopupView,
      queryTabs,
      requestImmediateBlock,
      setPopupView,
      sendTabMessage
    };
  }

  if (typeof document !== 'undefined') {
    init(document);
  }
})();
