const assert = require('node:assert/strict');
const test = require('node:test');

const sharedBlocklist = require('../src/shared/blocklist.js');
const sharedContent = require('../src/content/shared.js');
const {
  createFollowerBlockCandidates,
  normalizeFollowerBlockCandidate
} = require('../src/shared/follower-candidates.js');
const sharedFollowers = require('../src/shared/followers.js');
const sharedSettings = require('../src/shared/settings.js');
const contentFeatures = require('../src/content/features.js');

const {
  BLOCK_BUTTON_ATTRIBUTE,
  BUTTON_ACTION_ATTRIBUTE,
  BUTTON_ACTIONS,
  BUTTON_KINDS,
  DEFAULT_BATCH_BLOCK_DELAY_MS,
  DEFAULT_PAGE_BLOCK_BUTTON_STYLE,
  DEFAULT_PAGE_BLOCK_BUTTON_STYLES,
  DEFAULT_USER_CELL_ADD_BUTTON_STYLE,
  FOLLOWERS_PAGE_SIZE,
  FOLLOWERS_QUERY_IDS,
  FOLLOWING_QUERY_IDS,
  MAX_BATCH_BLOCK_DELAY_MS,
  MESSAGE_TYPES,
  MIN_BATCH_BLOCK_DELAY_MS,
  PAGE_BLOCK_BUTTON_STYLES_STORAGE_KEY,
  PAGE_BLOCK_BUTTON_STYLES,
  PAGE_BUTTON_STYLE_SURFACES,
  USER_CELL_ADD_BUTTON_STYLE_STORAGE_KEY,
  SELECTORS,
  USER_BY_SCREEN_NAME_QUERY_IDS,
  applyCurrentNativeButtonStyleToDocument,
  attachButtonToProfilePage,
  attachButtonToTweet,
  attachButtonToUserCell,
  blockFollowerCandidatesViaApi,
  blockUserByRestIdViaApi,
  blockUserByScreenNameViaApi,
  unblockUserByRestIdViaApi,
  unblockUserByScreenNameViaApi,
  blockUsernamesViaApi,
  buildFollowersLookupUrls,
  buildUserLookupUrls,
  buildXApiHeaders,
  cancelFollowerRun,
  collectTweets,
  collectUserCells,
  createApiBlockButton,
  createNativeBlockButton,
  createProfileBlockButton,
  createUserCellBlockButton,
  createUserCellListButton,
  discoverGraphqlQueryIds,
  extractGraphqlQueryIdsFromScriptText,
  extractXClientTransactionIndicesFromScriptText,
  extractXClientTransactionKeyFromDocument,
  createUsernameSet,
  extractScreenNameFromHref,
  getStoredPageButtonStyles,
  getStoredUserCellAddButtonStyle,
  getClientLanguage,
  getButtonTitle,
  getCsrfToken,
  fetchFollowersPage,
  finishFollowerRun,
  FOLLOWER_RUN_PORT_PREFIX,
  init,
  lookupUserRestId,
  normalizeBatchBlockDelayMs,
  normalizePageBlockButtonStyle,
  normalizePageBlockButtonStyles,
  normalizeUsername,
  observeStoredPageButtonStyle,
  observeStoredUserCellAddButtonStyle,
  observeStoredUserCellAddButtonVisibility,
  parseFollowersPage,
  parseUserLookupRestId,
  readCookieValue,
  readScreenNameFromProfilePage,
  readScreenNameFromTweet,
  registerRuntimeConnectionListener,
  registerRuntimeMessageListener,
  resolveOnDemandFileUrlFromRuntime,
  processNode,
  runProfileNativeBlockFlow,
  runNativeBlockFlow,
  scanFollowersForBlocking,
  setCurrentNativeButtonStyle,
  setCurrentNativeButtonStyles,
  setCurrentUserCellAddButtonStyle,
  setButtonState,
  sleep,
  startFollowerRun,
  syncUserCellListButtons,
  syncStoredPageButtonStyle,
  syncStoredUserCellAddButtonStyle,
  syncStoredUserCellAddButtonVisibility,
  tryGenerateXClientTransactionId,
  waitForElement
} = require('../src/content/main.js');

function createTweetStub(selectorMap) {
  return {
    querySelector(selector) {
      return selectorMap[selector] || null;
    }
  };
}

function flushAsyncWork() {
  return new Promise((resolve) => setImmediate(resolve));
}

function useGlobalOverrides(t, overrides) {
  const originalValues = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    originalValues.set(key, globalThis[key]);
    globalThis[key] = value;
  }

  t.after(() => {
    for (const [key, value] of originalValues.entries()) {
      if (value === undefined) {
        delete globalThis[key];
        continue;
      }

      globalThis[key] = value;
    }
  });
}

function dataAttributeNameToDatasetKey(name) {
  return String(name)
    .slice('data-'.length)
    .replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function createDomElement(overrides = {}) {
  const attributes = {};
  const listeners = new Map();
  const element = {
    attributes,
    dataset: {},
    disabled: false,
    hidden: false,
    innerHTML: '',
    style: {
      display: '',
      removeProperty(name) {
        if (name === 'display') {
          this.display = '';
        }
      },
      setProperty(name, value) {
        if (name === 'display') {
          this.display = value;
        }
      }
    },
    textContent: '',
    title: '',
    addEventListener(type, listener) {
      const typeListeners = listeners.get(type) || [];
      typeListeners.push(listener);
      listeners.set(type, typeListeners);
    },
    click() {
      const typeListeners = listeners.get('click') || [];

      for (const listener of typeListeners) {
        listener({
          currentTarget: element,
          preventDefault() {},
          stopPropagation() {},
          target: element,
          type: 'click'
        });
      }
    },
    dispatch(type) {
      const typeListeners = listeners.get(type) || [];

      for (const listener of typeListeners) {
        listener({
          currentTarget: element,
          preventDefault() {},
          stopPropagation() {},
          target: element,
          type
        });
      }
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
    },
    setAttribute(name, value) {
      attributes[name] = value;

      if (String(name).startsWith('data-')) {
        element.dataset[dataAttributeNameToDatasetKey(name)] = String(value);
      }
    },
    ...overrides
  };

  return element;
}

function findDescendant(node, predicate) {
  if (!node) {
    return null;
  }

  if (predicate(node)) {
    return node;
  }

  for (const child of Array.isArray(node.children) ? node.children : []) {
    const match = findDescendant(child, predicate);

    if (match) {
      return match;
    }
  }

  return null;
}

function detachFromParent(child) {
  const parent = child?.parentElement;

  if (!parent || !Array.isArray(parent.children)) {
    return;
  }

  const index = parent.children.indexOf(child);

  if (index !== -1) {
    parent.children.splice(index, 1);
  }
}

function insertChildBefore(parent, child, referenceNode) {
  detachFromParent(child);
  child.parentElement = parent;

  const index = parent.children.indexOf(referenceNode);

  if (index === -1) {
    parent.children.push(child);
    return;
  }

  parent.children.splice(index, 0, child);
}

function createDocumentStub() {
  const styles = new Map();
  const createdElements = [];
  const documentRef = {
    body: {},
    nodeType: 9,
    createElement(tagName) {
      const element = createDomElement({
        nodeType: 1,
        tagName
      });

      element.children = [];
      Object.defineProperty(element, 'firstElementChild', {
        get() {
          return element.children[0] || null;
        }
      });
      element.appendChild = (child) => {
        insertChildBefore(element, child, null);
      };
      element.insertBefore = (child, referenceNode) => {
        insertChildBefore(element, child, referenceNode);
      };

      createdElements.push(element);
      return element;
    },
    getElementById(id) {
      return styles.get(id) || null;
    },
    head: {
      appendedNodes: [],
      appendChild(node) {
        this.appendedNodes.push(node);

        if (node?.id) {
          styles.set(node.id, node);
        }
      }
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };

  return {
    createdElements,
    documentRef
  };
}

function createStorageExtensionApi(initialStore = {}) {
  const store = { ...initialStore };
  const listeners = [];

  return {
    runtime: {},
    storage: {
      local: {
        get(keys) {
          const response = {};

          for (const key of keys) {
            response[key] = store[key];
          }

          return Promise.resolve(response);
        },
        set(payload) {
          const changes = {};

          for (const [key, value] of Object.entries(payload)) {
            changes[key] = {
              oldValue: store[key],
              newValue: value
            };
            store[key] = value;
          }

          for (const listener of listeners) {
            listener(changes, 'local');
          }

          return Promise.resolve();
        }
      },
      onChanged: {
        addListener(listener) {
          listeners.push(listener);
        },
        removeListener(listener) {
          const index = listeners.indexOf(listener);

          if (index !== -1) {
            listeners.splice(index, 1);
          }
        }
      }
    },
    store
  };
}

function createTweetNode(screenName = 'Felixmfdo', options = {}) {
  const leadingActionButton = createDomElement({
    nodeType: 1,
    tagName: 'BUTTON',
    matches(selector) {
      return selector === 'button' || selector === SELECTORS.grokButton;
    }
  });
  const caretButton = createDomElement({
    nodeType: 1,
    tagName: 'BUTTON',
    matches(selector) {
      return selector === 'button' || selector === SELECTORS.caretButton;
    }
  });
  const metadataColumn = {
    nodeType: 1,
    children: [],
    querySelector() {
      return null;
    }
  };
  const localButtonGroup = {
    nodeType: 1,
    get firstElementChild() {
      return localButtonGroup.children[0] || null;
    },
    children: [caretButton],
    appendChild(child) {
      insertChildBefore(localButtonGroup, child, null);
    },
    insertBefore(child, referenceNode) {
      insertChildBefore(localButtonGroup, child, referenceNode);
    }
  };
  const localButtonGroupWrapper = {
    nodeType: 1,
    children: [localButtonGroup],
    querySelector(selector) {
      return selector === 'button' ? caretButton : null;
    }
  };
  const trailingAction = {
    nodeType: 1,
    children: [localButtonGroupWrapper],
    querySelector(selector) {
      return selector === 'button' ? caretButton : null;
    }
  };
  const leadingAction = {
    nodeType: 1,
    get firstElementChild() {
      return leadingAction.children[0] || null;
    },
    children: [leadingActionButton],
    insertBefore(child, referenceNode) {
      insertChildBefore(leadingAction, child, referenceNode);
    },
    querySelector(selector) {
      return selector === 'button' || selector === SELECTORS.grokButton ? leadingActionButton : null;
    }
  };
  const parentElement = {
    nodeType: 1,
    get firstElementChild() {
      return parentElement.children[0] || null;
    },
    children: options.includeLeadingAction === false ? [trailingAction] : [leadingAction, trailingAction],
    insertBefore(child, referenceNode) {
      insertChildBefore(parentElement, child, referenceNode);
    }
  };
  const headerRow = {
    nodeType: 1,
    children: [metadataColumn, parentElement],
    querySelector() {
      return null;
    }
  };

  metadataColumn.parentElement = headerRow;
  leadingAction.parentElement = parentElement;
  leadingActionButton.parentElement = leadingAction;
  trailingAction.parentElement = parentElement;
  localButtonGroupWrapper.parentElement = trailingAction;
  localButtonGroup.parentElement = localButtonGroupWrapper;
  caretButton.parentElement = localButtonGroup;
  parentElement.parentElement = headerRow;

  const tweetNode = {
    nodeType: 1,
    matches(selector) {
      return selector === SELECTORS.tweet;
    },
    querySelector(selector) {
      if (selector === `[${BLOCK_BUTTON_ATTRIBUTE}]`) {
        return options.existingButton || findDescendant(tweetNode, (node) => (
          Object.prototype.hasOwnProperty.call(node.attributes || {}, BLOCK_BUTTON_ATTRIBUTE)
        ));
      }

      if (selector === SELECTORS.caretButton) {
        return caretButton;
      }

      if (selector === SELECTORS.permalink) {
        if (options.includePermalink === false) {
          return null;
        }

        return {
          getAttribute(name) {
            return name === 'href' ? `/${screenName}/status/1` : null;
          }
        };
      }

      if (selector === SELECTORS.profileLink) {
        return options.profileLink || null;
      }

      if (selector === SELECTORS.avatarContainer) {
        return options.avatarContainer || null;
      }

      return null;
    },
    querySelectorAll() {
      return [];
    },
    children: [headerRow]
  };

  headerRow.parentElement = tweetNode;

  return {
    caretButton,
    leadingAction,
    leadingActionButton,
    localButtonGroup,
    parentElement,
    tweetNode
  };
}

function createProfilePageDocument(screenName = 'Felixmfdo') {
  const { createdElements, documentRef } = createDocumentStub();
  const moreButton = createDomElement({
    nodeType: 1,
    tagName: 'BUTTON',
    matches(selector) {
      return selector === 'button' || selector === SELECTORS.profileActionsButton;
    }
  });
  const messageButton = createDomElement({
    nodeType: 1,
    tagName: 'BUTTON',
    matches(selector) {
      return selector === 'button';
    }
  });
  const followButton = createDomElement({
    nodeType: 1,
    tagName: 'BUTTON',
    matches(selector) {
      return selector === 'button';
    }
  });
  const placementTracking = {
    nodeType: 1,
    children: [followButton],
    querySelector(selector) {
      return selector === 'button' ? followButton : null;
    }
  };
  const actionBar = {
    nodeType: 1,
    get firstElementChild() {
      return actionBar.children[0] || null;
    },
    children: [moreButton, messageButton, placementTracking],
    insertBefore(child, referenceNode) {
      insertChildBefore(actionBar, child, referenceNode);
    },
    querySelector(selector) {
      if (selector === SELECTORS.profileActionsButton) {
        return moreButton;
      }

      if (selector === `[${BLOCK_BUTTON_ATTRIBUTE}]`) {
        return findDescendant(actionBar, (node) => (
          typeof node?.getAttribute === 'function'
          && node.getAttribute(BLOCK_BUTTON_ATTRIBUTE) !== null
        ));
      }

      return null;
    }
  };

  moreButton.parentElement = actionBar;
  messageButton.parentElement = actionBar;
  placementTracking.parentElement = actionBar;
  followButton.parentElement = placementTracking;

  documentRef.location = {
    origin: 'https://x.com',
    pathname: `/${screenName}`
  };
  documentRef.querySelector = (selector) => {
    if (selector === SELECTORS.profileActionsButton) {
      return moreButton;
    }

    return null;
  };
  documentRef.querySelectorAll = (selector) => {
    if (selector === SELECTORS.tweet) {
      return [];
    }

    if (selector === `[${BLOCK_BUTTON_ATTRIBUTE}][data-kind="native"]`) {
      const managedButton = actionBar.querySelector(`[${BLOCK_BUTTON_ATTRIBUTE}]`);
      return managedButton ? [managedButton] : [];
    }

    return [];
  };

  return {
    actionBar,
    createdElements,
    documentRef,
    followButton,
    messageButton,
    moreButton,
    placementTracking
  };
}

function createUserCellNode(screenName = 'Felixmfdo') {
  const followButton = createDomElement({
    nodeType: 1,
    tagName: 'BUTTON',
    matches(selector) {
      return selector === 'button';
    }
  });
  const followButtonWrapper = createDomElement({
    nodeType: 1,
    children: [followButton],
    insertBefore(child, referenceNode) {
      insertChildBefore(followButtonWrapper, child, referenceNode);
    },
    querySelector(selector) {
      return selector === 'button' ? followButton : null;
    }
  });
  const detailsColumn = {
    nodeType: 1,
    children: [],
    querySelector() {
      return null;
    }
  };
  const assistiveText = {
    nodeType: 1,
    children: [],
    querySelector() {
      return null;
    }
  };
  const actionRow = {
    nodeType: 1,
    get firstElementChild() {
      return actionRow.children[0] || null;
    },
    children: [detailsColumn, followButtonWrapper, assistiveText],
    insertBefore(child, referenceNode) {
      insertChildBefore(actionRow, child, referenceNode);
    },
    querySelector(selector) {
      return selector === 'button' ? followButton : null;
    }
  };

  followButton.parentElement = followButtonWrapper;
  followButtonWrapper.parentElement = actionRow;
  detailsColumn.parentElement = actionRow;
  assistiveText.parentElement = actionRow;

  const userCell = {
    nodeType: 1,
    tagName: 'BUTTON',
    matches(selector) {
      return selector === 'button' || selector === SELECTORS.userCell;
    },
    querySelector(selector) {
      if (selector === SELECTORS.permalink) {
        return null;
      }

      if (selector === SELECTORS.profileLink) {
        return {
          getAttribute(name) {
            return name === 'href' ? `/${screenName}` : null;
          }
        };
      }

      if (selector === SELECTORS.avatarContainer) {
        return null;
      }

      return null;
    },
    querySelectorAll(selector) {
      return selector === SELECTORS.userCell ? [] : [];
    },
    children: [actionRow]
  };

  actionRow.parentElement = userCell;

  return {
    actionRow,
    followButton,
    followButtonWrapper,
    userCell
  };
}

test('extractScreenNameFromHref reads a screen name from tweet permalinks', () => {
  assert.equal(extractScreenNameFromHref('/Felixmfdo/status/2072691291956068443'), 'Felixmfdo');
  assert.equal(extractScreenNameFromHref('https://x.com/Felixmfdo/status/2072691291956068443'), 'Felixmfdo');
});

test('extractScreenNameFromHref reads a screen name from profile links', () => {
  assert.equal(extractScreenNameFromHref('/Felixmfdo'), 'Felixmfdo');
  assert.equal(extractScreenNameFromHref('https://twitter.com/Felixmfdo'), 'Felixmfdo');
});

test('extractScreenNameFromHref rejects reserved internal paths', () => {
  assert.equal(extractScreenNameFromHref('/i/web/status/2072691291956068443'), null);
  assert.equal(extractScreenNameFromHref('/home'), null);
  assert.equal(extractScreenNameFromHref('/login'), null);
  assert.equal(extractScreenNameFromHref('/search?q=test'), null);
});

test('content shared re-exports the shared reserved path set without copying it', () => {
  assert.equal(sharedContent.RESERVED_PATH_SEGMENTS, sharedFollowers.RESERVED_PATH_SEGMENTS);
});

test('readScreenNameFromTweet prefers the tweet permalink', () => {
  const tweet = createTweetStub({
    [SELECTORS.permalink]: {
      getAttribute(name) {
        return name === 'href' ? '/Felixmfdo/status/2072691291956068443' : null;
      }
    },
    [SELECTORS.profileLink]: {
      getAttribute(name) {
        return name === 'href' ? '/SomeoneElse' : null;
      }
    }
  });

  assert.equal(readScreenNameFromTweet(tweet), 'Felixmfdo');
});

test('readScreenNameFromTweet falls back to the profile link', () => {
  const tweet = createTweetStub({
    [SELECTORS.profileLink]: {
      getAttribute(name) {
        return name === 'href' ? '/Felixmfdo' : null;
      }
    }
  });

  assert.equal(readScreenNameFromTweet(tweet), 'Felixmfdo');
});

test('readScreenNameFromTweet falls back to avatar data-testid', () => {
  const tweet = createTweetStub({
    [SELECTORS.avatarContainer]: {
      getAttribute(name) {
        return name === 'data-testid' ? 'UserAvatar-Container-Felixmfdo' : null;
      }
    }
  });

  assert.equal(readScreenNameFromTweet(tweet), 'Felixmfdo');
});

test('readScreenNameFromProfilePage reads the username from the current profile path', () => {
  assert.equal(readScreenNameFromProfilePage({
    location: { pathname: '/Felixmfdo' }
  }), 'Felixmfdo');
  assert.equal(readScreenNameFromProfilePage({
    location: { pathname: '/Felixmfdo/with_replies' }
  }), 'Felixmfdo');
  assert.equal(readScreenNameFromProfilePage({
    location: { pathname: '/home' }
  }), null);
});

test('setButtonState updates the visible label and accessibility metadata', (t) => {
  const attributes = {};
  setCurrentNativeButtonStyles({
    ...DEFAULT_PAGE_BLOCK_BUTTON_STYLES,
    [PAGE_BUTTON_STYLE_SURFACES.tweet]: PAGE_BLOCK_BUTTON_STYLES.text
  });
  t.after(() => {
    setCurrentNativeButtonStyles(DEFAULT_PAGE_BLOCK_BUTTON_STYLES);
  });
  const button = {
    dataset: {
      kind: BUTTON_KINDS.native
    },
    disabled: false,
    textContent: '',
    title: '',
    setAttribute(name, value) {
      attributes[name] = value;
    }
  };

  setButtonState(button, 'running', 'Felixmfdo');
  assert.equal(button.dataset.state, 'running');
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Blocking...');
  assert.equal(button.title, 'Blocking @Felixmfdo using X menu flow');
  assert.equal(attributes['aria-label'], 'Blocking @Felixmfdo using X menu flow');

  setButtonState(button, 'success', 'Felixmfdo');
  assert.equal(button.dataset.state, 'success');
  assert.equal(button.textContent, 'Blocked');
  assert.equal(getButtonTitle(BUTTON_KINDS.native, 'Felixmfdo', 'success'), 'Blocked @Felixmfdo using X menu flow');
});

test('setButtonState uses API-specific labels and titles for the experimental button', () => {
  const attributes = {};
  const button = {
    dataset: {
      kind: BUTTON_KINDS.api
    },
    disabled: false,
    textContent: '',
    title: '',
    setAttribute(name, value) {
      attributes[name] = value;
    }
  };

  setButtonState(button, 'idle', 'Felixmfdo');
  assert.equal(button.textContent, 'API');
  assert.equal(button.title, 'Try blocking @Felixmfdo via internal API');
  assert.equal(attributes['aria-label'], 'Try blocking @Felixmfdo via internal API');

  setButtonState(button, 'success', 'Felixmfdo');
  assert.equal(button.textContent, 'API ok');
  assert.equal(button.title, 'Blocked @Felixmfdo via internal API');
});

test('setButtonState uses list-specific titles for user cell buttons', (t) => {
  const attributes = {};
  setCurrentNativeButtonStyles({
    ...DEFAULT_PAGE_BLOCK_BUTTON_STYLES,
    [PAGE_BUTTON_STYLE_SURFACES.userCell]: PAGE_BLOCK_BUTTON_STYLES.text
  });
  t.after(() => {
    setCurrentNativeButtonStyles(DEFAULT_PAGE_BLOCK_BUTTON_STYLES);
  });
  const button = {
    dataset: {
      kind: BUTTON_KINDS.native,
      surface: 'user-cell',
      userCellBlockMode: 'block'
    },
    disabled: false,
    textContent: '',
    title: '',
    setAttribute(name, value) {
      attributes[name] = value;
    }
  };

  setButtonState(button, 'idle', 'Felixmfdo');
  assert.equal(button.title, 'Block @Felixmfdo from this list');

  setButtonState(button, 'success', 'Felixmfdo');
  assert.equal(button.title, 'Blocked @Felixmfdo from this list');
  assert.equal(attributes['aria-label'], 'Blocked @Felixmfdo from this list');

  button.dataset.userCellBlockMode = 'unblock';
  setButtonState(button, 'unblock', 'Felixmfdo');
  assert.equal(button.textContent, 'Unblock');
  assert.equal(button.title, 'Unblock @Felixmfdo from this list');
  assert.equal(button.disabled, false);

  setButtonState(button, 'running-unblock', 'Felixmfdo');
  assert.equal(button.textContent, 'Unblocking...');
  assert.equal(button.title, 'Unblocking @Felixmfdo from this list');

  setButtonState(button, 'error', 'Felixmfdo');
  assert.equal(button.textContent, 'Retry unblock');
  assert.equal(button.title, 'Retry unblock for @Felixmfdo from this list');
  assert.equal(attributes['aria-label'], 'Retry unblock for @Felixmfdo from this list');
});

test('setButtonState renders save-to-list labels and keeps listed buttons clickable for removal', (t) => {
  setCurrentUserCellAddButtonStyle(PAGE_BLOCK_BUTTON_STYLES.text);
  t.after(() => {
    setCurrentUserCellAddButtonStyle(DEFAULT_USER_CELL_ADD_BUTTON_STYLE);
  });
  const attributes = {
    'data-easy-tweetblock-action': BUTTON_ACTIONS.saveToList
  };
  const button = {
    dataset: {
      easyTweetblockAction: BUTTON_ACTIONS.saveToList,
      surface: 'user-cell'
    },
    disabled: false,
    getAttribute(name) {
      return attributes[name] || null;
    },
    innerHTML: '',
    textContent: '',
    title: '',
    setAttribute(name, value) {
      attributes[name] = value;
    }
  };

  setButtonState(button, 'idle', 'Felixmfdo');
  assert.equal(button.textContent, 'Add');
  assert.equal(button.title, 'Add @Felixmfdo to the active list');
  assert.equal(button.disabled, false);

  setButtonState(button, 'listed', 'Felixmfdo');
  assert.equal(button.textContent, 'Remove');
  assert.equal(button.title, 'Remove @Felixmfdo from the active list');
  assert.equal(button.disabled, false);

  setButtonState(button, 'running-remove', 'Felixmfdo');
  assert.equal(button.textContent, 'Removing...');
  assert.equal(button.title, 'Removing @Felixmfdo from the active list');
  assert.equal(button.disabled, true);

  setButtonState(button, 'error-remove', 'Felixmfdo');
  assert.equal(button.textContent, 'Retry remove');
  assert.equal(button.title, 'Retry removing @Felixmfdo from the active list');
  assert.equal(button.disabled, false);

});

test('setButtonState renders save-to-list icons (plus and checkmark) in icon mode', (t) => {
  const attributes = {
    'data-easy-tweetblock-action': BUTTON_ACTIONS.saveToList
  };
  setCurrentUserCellAddButtonStyle(PAGE_BLOCK_BUTTON_STYLES.icon);
  t.after(() => {
    setCurrentUserCellAddButtonStyle(DEFAULT_USER_CELL_ADD_BUTTON_STYLE);
  });
  const button = {
    dataset: {
      easyTweetblockAction: BUTTON_ACTIONS.saveToList,
      surface: 'user-cell'
    },
    disabled: false,
    getAttribute(name) {
      return attributes[name] || null;
    },
    innerHTML: '',
    textContent: '',
    title: '',
    setAttribute(name, value) {
      attributes[name] = value;
    }
  };

  setButtonState(button, 'idle', 'Felixmfdo');
  assert.equal(button.innerHTML.includes('M11.25 4.75'), true); // ADD_ICON_SVG path
  assert.equal(button.innerHTML.includes('M9.55 16.94'), false); // CHECK_ICON_SVG path not present yet

  setButtonState(button, 'listed', 'Felixmfdo');
  assert.equal(button.innerHTML.includes('M11.25 4.75'), false); // ADD_ICON_SVG path should not be present
  assert.equal(button.innerHTML.includes('M9.55 16.94'), true); // CHECK_ICON_SVG path present

  setButtonState(button, 'running-remove', 'Felixmfdo');
  assert.equal(button.innerHTML.includes('M9.55 16.94'), true); // CHECK_ICON_SVG path remains present while removing

  setButtonState(button, 'error-remove', 'Felixmfdo');
  assert.equal(button.innerHTML.includes('M9.55 16.94'), true); // CHECK_ICON_SVG path remains present for remove retry

  setButtonState(button, 'success', 'Felixmfdo');
  assert.equal(button.innerHTML.includes('M9.55 16.94'), true); // CHECK_ICON_SVG path present
});

test('setButtonState keeps the block icon for user-cell success states in icon mode', (t) => {
  setCurrentNativeButtonStyles({
    ...DEFAULT_PAGE_BLOCK_BUTTON_STYLES,
    [PAGE_BUTTON_STYLE_SURFACES.userCell]: PAGE_BLOCK_BUTTON_STYLES.icon
  });
  t.after(() => {
    setCurrentNativeButtonStyles(DEFAULT_PAGE_BLOCK_BUTTON_STYLES);
  });
  const button = {
    dataset: {
      kind: BUTTON_KINDS.native,
      surface: 'user-cell'
    },
    disabled: false,
    innerHTML: '',
    textContent: '',
    title: '',
    setAttribute() {}
  };

  setButtonState(button, 'idle', 'Felixmfdo');
  assert.equal(button.innerHTML.includes('M12 3.75'), true);

  setButtonState(button, 'success', 'Felixmfdo');
  assert.equal(button.innerHTML.includes('M12 3.75'), true);

  setButtonState(button, 'blocked', 'Felixmfdo');
  assert.equal(button.innerHTML.includes('M12 3.75'), true);
});

test('setButtonState keeps the block icon for non-list native buttons after success', (t) => {
  setCurrentNativeButtonStyles({
    ...DEFAULT_PAGE_BLOCK_BUTTON_STYLES,
    [PAGE_BUTTON_STYLE_SURFACES.tweet]: PAGE_BLOCK_BUTTON_STYLES.icon
  });
  t.after(() => {
    setCurrentNativeButtonStyles(DEFAULT_PAGE_BLOCK_BUTTON_STYLES);
  });
  const button = {
    dataset: {
      kind: BUTTON_KINDS.native,
      surface: 'tweet'
    },
    disabled: false,
    innerHTML: '',
    textContent: '',
    title: '',
    setAttribute() {}
  };

  setButtonState(button, 'success', 'Felixmfdo');
  assert.equal(button.innerHTML.includes('M12 3.75'), true);
  assert.equal(button.innerHTML.includes('M9.55 16.94'), false);
});

test('setButtonState recalculates display style from current settings instead of cached dataset', (t) => {
  t.after(() => {
    setCurrentNativeButtonStyles(DEFAULT_PAGE_BLOCK_BUTTON_STYLES);
    setCurrentUserCellAddButtonStyle(DEFAULT_USER_CELL_ADD_BUTTON_STYLE);
  });

  setCurrentNativeButtonStyles({
    ...DEFAULT_PAGE_BLOCK_BUTTON_STYLES,
    [PAGE_BUTTON_STYLE_SURFACES.tweet]: PAGE_BLOCK_BUTTON_STYLES.text
  });

  const nativeButton = {
    dataset: {
      displayStyle: PAGE_BLOCK_BUTTON_STYLES.icon,
      kind: BUTTON_KINDS.native,
      surface: PAGE_BUTTON_STYLE_SURFACES.tweet
    },
    disabled: false,
    innerHTML: '',
    textContent: '',
    title: '',
    setAttribute() {}
  };

  setButtonState(nativeButton, 'idle', 'Felixmfdo');
  assert.equal(nativeButton.dataset.displayStyle, PAGE_BLOCK_BUTTON_STYLES.text);
  assert.equal(nativeButton.textContent, 'Block');

  setCurrentNativeButtonStyles({
    ...DEFAULT_PAGE_BLOCK_BUTTON_STYLES,
    [PAGE_BUTTON_STYLE_SURFACES.tweet]: PAGE_BLOCK_BUTTON_STYLES.icon
  });
  setButtonState(nativeButton, 'error', 'Felixmfdo');
  assert.equal(nativeButton.dataset.displayStyle, PAGE_BLOCK_BUTTON_STYLES.icon);
  assert.equal(nativeButton.innerHTML.includes('M12 3.75'), true);

  setCurrentUserCellAddButtonStyle(PAGE_BLOCK_BUTTON_STYLES.icon);

  const listAttributes = {
    [BUTTON_ACTION_ATTRIBUTE]: BUTTON_ACTIONS.saveToList
  };
  const listButton = {
    dataset: {
      displayStyle: PAGE_BLOCK_BUTTON_STYLES.text,
      easyTweetblockAction: BUTTON_ACTIONS.saveToList,
      surface: PAGE_BUTTON_STYLE_SURFACES.userCell
    },
    disabled: false,
    getAttribute(name) {
      return listAttributes[name] || null;
    },
    innerHTML: '',
    textContent: '',
    title: '',
    setAttribute(name, value) {
      listAttributes[name] = value;
    }
  };

  setButtonState(listButton, 'idle', 'Felixmfdo');
  assert.equal(listButton.dataset.displayStyle, PAGE_BLOCK_BUTTON_STYLES.icon);
  assert.equal(listButton.innerHTML.includes('M11.25 4.75'), true);

  setCurrentUserCellAddButtonStyle(PAGE_BLOCK_BUTTON_STYLES.text);
  setButtonState(listButton, 'listed', 'Felixmfdo');
  assert.equal(listButton.dataset.displayStyle, PAGE_BLOCK_BUTTON_STYLES.text);
  assert.equal(listButton.textContent, 'Remove');
});

test('waitForElement resolves when an element appears and rejects on timeout', async (t) => {
  const originalSetTimeout = globalThis.setTimeout;
  let callCount = 0;
  const match = { id: 'ready' };

  t.after(() => {
    globalThis.setTimeout = originalSetTimeout;
  });

  globalThis.setTimeout = (callback) => {
    callback();
    return 0;
  };

  const resolved = await waitForElement('.match', {
    querySelector() {
      callCount += 1;
      return callCount === 2 ? match : null;
    }
  }, 100);

  assert.equal(resolved, match);
  await assert.rejects(waitForElement('.missing', {
    querySelector() {
      return null;
    }
  }, 0), /Timed out waiting for \.missing/);
});

test('runNativeBlockFlow clicks the caret, block action, and confirmation button', async () => {
  const clickOrder = [];
  const caretButton = {
    click() {
      clickOrder.push('caret');
    }
  };
  const blockMenuItem = {
    click() {
      clickOrder.push('menu');
    }
  };
  const confirmButton = {
    click() {
      clickOrder.push('confirm');
    }
  };

  await runNativeBlockFlow({
    querySelector(selector) {
      return selector === SELECTORS.caretButton ? caretButton : null;
    }
  }, {
    querySelector(selector) {
      if (selector === SELECTORS.blockMenuItem) {
        return blockMenuItem;
      }

      if (selector === SELECTORS.blockConfirmButton) {
        return confirmButton;
      }

      return null;
    }
  });

  assert.deepEqual(clickOrder, ['caret', 'menu', 'confirm']);
});

test('runNativeBlockFlow requires the tweet caret button', async () => {
  await assert.rejects(runNativeBlockFlow({
    querySelector() {
      return null;
    }
  }, {
    querySelector() {
      return null;
    }
  }), /Missing tweet caret button/);
});

test('readCookieValue and getCsrfToken parse cookie values safely', () => {
  const cookieSource = 'lang=en; ct0=abc123%3Dtoken; theme=dark';

  assert.equal(readCookieValue(cookieSource, 'ct0'), 'abc123=token');
  assert.equal(readCookieValue(cookieSource, 'missing'), null);
  assert.equal(getCsrfToken({ cookie: cookieSource }), 'abc123=token');
});

test('getClientLanguage returns the page language primary tag', () => {
  assert.equal(getClientLanguage({ documentElement: { lang: 'pl-PL' } }), 'pl');
  assert.equal(getClientLanguage({ documentElement: { lang: '' } }), 'en');
});

test('buildXApiHeaders includes the shared web bearer and csrf token', () => {
  const headers = buildXApiHeaders({
    cookie: 'ct0=token123',
    documentElement: { lang: 'en-US' }
  }, {
    'content-type': 'application/x-www-form-urlencoded'
  });

  assert.equal(headers.authorization.startsWith('Bearer '), true);
  assert.equal(headers['x-csrf-token'], 'token123');
  assert.equal(headers['x-twitter-client-language'], 'en');
  assert.equal(headers['content-type'], 'application/x-www-form-urlencoded');
});

test('buildUserLookupUrls creates one candidate URL per known query id', () => {
  const urls = buildUserLookupUrls('Felixmfdo', 'https://x.com');
  const lookupUrl = new URL(urls[0]);

  assert.equal(urls.length, USER_BY_SCREEN_NAME_QUERY_IDS.length);
  assert.equal(urls[0].startsWith(`https://x.com/i/api/graphql/${USER_BY_SCREEN_NAME_QUERY_IDS[0]}/UserByScreenName?`), true);
  assert.equal(urls[0].includes('screen_name'), true);
  assert.equal(urls[0].includes('Felixmfdo'), true);
  assert.deepEqual(JSON.parse(lookupUrl.searchParams.get('features')), contentFeatures.USER_BY_SCREEN_NAME_FEATURES);
});

test('buildFollowersLookupUrls creates one candidate URL per known followers query id', () => {
  const urls = buildFollowersLookupUrls('2743192327', {
    baseOrigin: 'https://x.com',
    count: FOLLOWERS_PAGE_SIZE,
    cursor: 'bottom-cursor'
  });
  const lookupUrl = new URL(urls[0]);

  assert.equal(urls.length, FOLLOWERS_QUERY_IDS.length);
  assert.equal(urls[0].startsWith(`https://x.com/i/api/graphql/${FOLLOWERS_QUERY_IDS[0]}/Followers?`), true);
  assert.equal(urls[0].includes('2743192327'), true);
  assert.equal(urls[0].includes('bottom-cursor'), true);
  assert.deepEqual(JSON.parse(lookupUrl.searchParams.get('features')), contentFeatures.FOLLOWERS_FEATURES);
});

test('buildFollowersLookupUrls creates Following URLs for the following source', () => {
  const urls = buildFollowersLookupUrls('1958695191897841664', {
    baseOrigin: 'https://x.com',
    source: 'following'
  });

  assert.equal(urls.length, FOLLOWING_QUERY_IDS.length);
  assert.equal(urls[0].startsWith(`https://x.com/i/api/graphql/${FOLLOWING_QUERY_IDS[0]}/Following?`), true);
  assert.equal(JSON.parse(new URL(urls[0]).searchParams.get('variables')).count, FOLLOWERS_PAGE_SIZE);
});

test('buildFollowersLookupUrls clamps count without treating zero as missing', () => {
  const urls = buildFollowersLookupUrls('2743192327', {
    baseOrigin: 'https://x.com',
    count: 0
  });

  assert.equal(JSON.parse(new URL(urls[0]).searchParams.get('variables')).count, 1);
});

test('parseUserLookupRestId reads rest_id from common response shapes', () => {
  assert.equal(parseUserLookupRestId({
    data: {
      user: {
        result: {
          rest_id: '123'
        }
      }
    }
  }), '123');

  assert.equal(parseUserLookupRestId({
    data: {
      user_result_by_screen_name: {
        result: {
          rest_id: '456'
        }
      }
    }
  }), '456');

  assert.equal(parseUserLookupRestId({ data: {} }), null);
});

test('parseFollowersPage extracts users, blocking state, and the next cursor', () => {
  const page = parseFollowersPage({
    data: {
      user: {
        result: {
          timeline: {
            timeline: {
              instructions: [{
                entries: [
                  {
                    content: {
                      itemContent: {
                        user_results: {
                          result: {
                            core: { screen_name: 'Alice' },
                            relationship_perspectives: { blocking: false },
                            rest_id: '101'
                          }
                        }
                      }
                    }
                  },
                  {
                    content: {
                      itemContent: {
                        user_results: {
                          result: {
                            legacy: { screen_name: 'Bob' },
                            relationship_perspectives: { blocking: true },
                            rest_id: '202'
                          }
                        }
                      }
                    }
                  },
                  {
                    content: {
                      cursorType: 'Bottom',
                      value: 'cursor-bottom'
                    }
                  }
                ]
              }]
            }
          }
        }
      }
    }
  });

  assert.deepEqual(page, {
    hasNext: true,
    nextCursor: 'cursor-bottom',
    users: [
      {
        blockedBy: false,
        blocking: false,
        restId: '101',
        username: 'alice'
      },
      {
        blockedBy: false,
        blocking: true,
        restId: '202',
        username: 'bob'
      }
    ]
  });
});

test('lookupUserRestId retries stale query ids until one returns rest_id', async () => {
  const requestedUrls = [];
  const cache = new Map();
  const responses = [
    {
      ok: false,
      status: 404
    },
    {
      ok: true,
      async json() {
        return {
          data: {
            user: {
              result: {
                rest_id: '2057563419742486528'
              }
            }
          }
        };
      }
    }
  ];

  async function fetchImpl(url) {
    requestedUrls.push(url);
    return responses.shift();
  }

  const restId = await lookupUserRestId('Felixmfdo', {
    cache,
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    fetchImpl,
    queryIds: ['staleQueryId', 'workingQueryId']
  });

  assert.equal(restId, '2057563419742486528');
  assert.equal(cache.get('felixmfdo'), '2057563419742486528');
  assert.equal(requestedUrls.length, 2);
  assert.equal(requestedUrls[0].includes('/staleQueryId/UserByScreenName'), true);
  assert.equal(requestedUrls[1].includes('/workingQueryId/UserByScreenName'), true);
});

test('fetchFollowersPage retries stale followers query ids until one returns a page', async () => {
  const requestedUrls = [];
  const responses = [
    {
      ok: false,
      status: 404
    },
    {
      ok: true,
      async json() {
        return {
          data: {
            user: {
              result: {
                timeline: {
                  timeline: {
                    instructions: [{
                      entries: [{
                        content: {
                          itemContent: {
                            user_results: {
                              result: {
                                core: { screen_name: 'Alice' },
                                relationship_perspectives: { blocking: false },
                                rest_id: '101'
                              }
                            }
                          }
                        }
                      }]
                    }]
                  }
                }
              }
            }
          }
        };
      }
    }
  ];

  async function fetchImpl(url) {
    requestedUrls.push(url);
    return responses.shift();
  }

  const page = await fetchFollowersPage('2743192327', {
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    fetchImpl,
    queryIds: ['staleFollowersQueryId', 'workingFollowersQueryId']
  });

  assert.equal(page.users.length, 1);
  assert.equal(page.users[0].username, 'alice');
  assert.equal(requestedUrls.length, 2);
  assert.equal(requestedUrls[0].includes('/staleFollowersQueryId/Followers'), true);
  assert.equal(requestedUrls[1].includes('/workingFollowersQueryId/Followers'), true);
});

test('fetchFollowersPage surfaces invalid HTML bodies with a clear JSON parse error', async () => {
  await assert.rejects(fetchFollowersPage('2743192327', {
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' },
      querySelectorAll() {
        return [];
      }
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return name === 'content-type' ? 'text/html' : null;
        }
      },
      async text() {
        return '<!DOCTYPE html><html><body>Challenge</body></html>';
      }
    }),
    queryIds: ['workingFollowersQueryId']
  }), /returned invalid JSON \(status 200, content-type text\/html\): <!DOCTYPE html><html><body>Challenge<\/body><\/html>/);
});

test('lookupUserRestId reuses the current tab cache without another network lookup', async () => {
  const requestedUrls = [];
  const cache = new Map([
    ['felixmfdo', '2057563419742486528']
  ]);

  async function fetchImpl(url) {
    requestedUrls.push(url);
    throw new Error('fetch should not run when rest_id is cached');
  }

  const restId = await lookupUserRestId('Felixmfdo', {
    cache,
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    fetchImpl,
    queryIds: ['workingQueryId']
  });

  assert.equal(restId, '2057563419742486528');
  assert.deepEqual(requestedUrls, []);
});

test('lookupUserRestId includes generated x-client-transaction-id when available', async (t) => {
  const requestedHeaders = [];
  const originalGenerator = globalThis.EasyTweetBlockContent.tryGenerateXClientTransactionId;

  t.after(() => {
    globalThis.EasyTweetBlockContent.tryGenerateXClientTransactionId = originalGenerator;
  });

  globalThis.EasyTweetBlockContent.tryGenerateXClientTransactionId = async (method, path) => {
    assert.equal(method, 'GET');
    assert.equal(path, '/i/api/graphql/workingQueryId/UserByScreenName');
    return 'generated-transaction-id';
  };

  async function fetchImpl(_url, options = {}) {
    requestedHeaders.push(options.headers || {});

    return {
      ok: true,
      async json() {
        return {
          data: {
            user: {
              result: {
                rest_id: '2057563419742486528'
              }
            }
          }
        };
      }
    };
  }

  await lookupUserRestId('Felixmfdo', {
    cache: new Map(),
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    fetchImpl,
    queryIds: ['workingQueryId']
  });

  assert.equal(requestedHeaders[0]['x-client-transaction-id'], 'generated-transaction-id');
});

test('normalizeFollowerBlockCandidate and createFollowerBlockCandidates keep usable unique candidates only', () => {
  assert.deepEqual(normalizeFollowerBlockCandidate({ restId: '101', username: '@Alice' }), {
    restId: '101',
    username: 'alice'
  });
  assert.equal(normalizeFollowerBlockCandidate({ username: 'bad-name' }), null);

  assert.deepEqual(createFollowerBlockCandidates([
    { restId: '101', username: 'Alice' },
    { restId: '101', username: 'AliceAgain' },
    { username: 'Bob' },
    { username: 'bad-name' }
  ]), [
    { restId: '101', username: 'alice' },
    { restId: null, username: 'bob' }
  ]);
});

test('createFollowerBlockCandidates deduplicates a user appearing in both restId and username forms', () => {
  assert.deepEqual(createFollowerBlockCandidates([
    { restId: '101', username: 'Alice' },
    { username: 'Alice' }
  ]), [
    { restId: '101', username: 'alice' }
  ]);

  assert.deepEqual(createFollowerBlockCandidates([
    { username: 'Alice' },
    { restId: '101', username: 'Alice' }
  ]), [
    { restId: null, username: 'alice' }
  ]);

  assert.deepEqual(createFollowerBlockCandidates([
    { restId: '101', username: 'Alice' },
    { restId: '101', username: 'OtherName' }
  ]), [
    { restId: '101', username: 'alice' }
  ]);
});

function createFollowersLookupResponse(restId = '999') {
  return {
    ok: true,
    async json() {
      return {
        data: {
          user: {
            result: {
              rest_id: restId
            }
          }
        }
      };
    }
  };
}

function createFollowersUserEntry(screenName, restId, blocking = false) {
  return {
    content: {
      itemContent: {
        user_results: {
          result: {
            core: { screen_name: screenName },
            relationship_perspectives: { blocking },
            rest_id: restId
          }
        }
      }
    }
  };
}

function createFollowersBottomCursorEntry(cursor) {
  return {
    content: {
      cursorType: 'Bottom',
      value: cursor
    }
  };
}

function createFollowersTimelineResponse(entries) {
  return {
    ok: true,
    async json() {
      return {
        data: {
          user: {
            result: {
              timeline: {
                timeline: {
                  instructions: [{ entries }]
                }
              }
            }
          }
        }
      };
    }
  };
}

function createFollowersScanDocument(pathname = '/targetuser/followers') {
  return {
    cookie: 'ct0=token123',
    documentElement: { lang: 'en-US' },
    location: {
      origin: 'https://x.com',
      pathname
    }
  };
}

test('scanFollowersForBlocking skips already blocked followers and stops once the block limit is filled', async () => {
  const requestedFollowersUrls = [];

  async function fetchImpl(url) {
    if (url.includes('/UserByScreenName')) {
      return {
        ok: true,
        async json() {
          return {
            data: {
              user: {
                result: {
                  rest_id: '999'
                }
              }
            }
          };
        }
      };
    }

    requestedFollowersUrls.push(url);

    return {
      ok: true,
      async json() {
        return {
          data: {
            user: {
              result: {
                timeline: {
                  timeline: {
                    instructions: [{
                      entries: [
                        {
                          content: {
                            itemContent: {
                              user_results: {
                                result: {
                                  core: { screen_name: 'AlreadyBlocked' },
                                  relationship_perspectives: { blocking: true },
                                  rest_id: '301'
                                }
                              }
                            }
                          }
                        },
                        {
                          content: {
                            itemContent: {
                              user_results: {
                                result: {
                                  core: { screen_name: 'AlreadyBlockedAgain' },
                                  relationship_perspectives: { blocking: true },
                                  rest_id: '301'
                                }
                              }
                            }
                          }
                        },
                        {
                          content: {
                            itemContent: {
                              user_results: {
                                result: {
                                  core: { screen_name: 'Alice' },
                                  relationship_perspectives: { blocking: false },
                                  rest_id: '101'
                                }
                              }
                            }
                          }
                        },
                        {
                          content: {
                            itemContent: {
                              user_results: {
                                result: {
                                  core: { screen_name: 'Bob' },
                                  relationship_perspectives: { blocking: false },
                                  rest_id: '202'
                                }
                              }
                            }
                          }
                        },
                        {
                          content: {
                            cursorType: 'Bottom',
                            value: 'cursor-bottom'
                          }
                        }
                      ]
                    }]
                  }
                }
              }
            }
          }
        };
      }
    };
  }

  const preview = await scanFollowersForBlocking({
    blockLimit: 2,
    scanLimit: 10
  }, {
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: {
        origin: 'https://x.com',
        pathname: '/targetuser/followers'
      }
    },
    fetchImpl,
    queryIds: ['followersWorkingQueryId'],
    userLookupQueryIds: ['workingUserLookup']
  });

  assert.equal(preview.targetScreenName, 'targetuser');
  assert.equal(preview.targetRestId, '999');
  assert.equal(preview.scannedCount, 4);
  assert.equal(preview.alreadyBlockedCount, 1);
  assert.equal(preview.readyCount, 2);
  assert.equal(preview.stoppedByBlockLimit, true);
  assert.equal(requestedFollowersUrls.length, 1);

  const requestedFollowersVariables = new URL(requestedFollowersUrls[0]).searchParams.get('variables');

  assert.equal(requestedFollowersVariables.startsWith('{"userId"'), true);
  assert.equal(JSON.parse(requestedFollowersVariables).count, FOLLOWERS_PAGE_SIZE);
  assert.deepEqual(preview.candidates, [
    { restId: '101', username: 'alice' },
    { restId: '202', username: 'bob' }
  ]);
});

test('scanFollowersForBlocking returns resume state with pending users when blockLimit stops in the middle of a page', async () => {
  let timelineRequestCount = 0;

  async function fetchImpl(url) {
    if (url.includes('/UserByScreenName')) {
      return createFollowersLookupResponse();
    }

    timelineRequestCount += 1;

    return createFollowersTimelineResponse([
      createFollowersUserEntry('Alice', '101'),
      createFollowersUserEntry('Bob', '202'),
      createFollowersUserEntry('Charlie', '303'),
      createFollowersBottomCursorEntry('cursor-bottom')
    ]);
  }

  const preview = await scanFollowersForBlocking({
    blockLimit: 2,
    scanLimit: 10
  }, {
    documentRef: createFollowersScanDocument(),
    fetchImpl,
    queryIds: ['followersWorkingQueryId'],
    userLookupQueryIds: ['workingUserLookup']
  });

  assert.equal(timelineRequestCount, 1);
  assert.equal(preview.scannedCount, 2);
  assert.equal(preview.stoppedByBlockLimit, true);
  assert.equal(preview.hasMorePages, true);
  assert.deepEqual(preview.candidates, [
    { restId: '101', username: 'alice' },
    { restId: '202', username: 'bob' }
  ]);
  assert.deepEqual(preview.resumeState, {
    nextCursor: 'cursor-bottom',
    pendingUsers: [{ restId: '303', username: 'charlie', blocking: false }],
    alreadyBlockedKeys: [],
    hasMorePages: true
  });
});

test('scanFollowersForBlocking returns resume state with pending users when scanLimit stops in the middle of a page', async () => {
  async function fetchImpl(url) {
    if (url.includes('/UserByScreenName')) {
      return createFollowersLookupResponse();
    }

    return createFollowersTimelineResponse([
      createFollowersUserEntry('Alice', '101'),
      createFollowersUserEntry('Bob', '202'),
      createFollowersUserEntry('Charlie', '303'),
      createFollowersBottomCursorEntry('cursor-bottom')
    ]);
  }

  const preview = await scanFollowersForBlocking({
    blockLimit: 10,
    scanLimit: 2
  }, {
    documentRef: createFollowersScanDocument(),
    fetchImpl,
    queryIds: ['followersWorkingQueryId'],
    userLookupQueryIds: ['workingUserLookup']
  });

  assert.equal(preview.scannedCount, 2);
  assert.equal(preview.readyCount, 2);
  assert.equal(preview.stoppedByScanLimit, true);
  assert.equal(preview.hasMorePages, true);
  assert.deepEqual(preview.resumeState, {
    nextCursor: 'cursor-bottom',
    pendingUsers: [{ restId: '303', username: 'charlie', blocking: false }],
    alreadyBlockedKeys: [],
    hasMorePages: true
  });
});

test('scanFollowersForBlocking returns zero counters and echoes resumeState when the existing ready queue already fills the block limit', async () => {
  let timelineRequestCount = 0;
  const resumeState = {
    alreadyBlockedKeys: ['id:301'],
    existingReadyCount: 2,
    existingReadyKeys: ['id:101', 'username:alice'],
    hasMorePages: true,
    nextCursor: 'cursor-resume',
    pendingUsers: [{ restId: '202', username: 'bob', blocking: false }]
  };

  async function fetchImpl(url) {
    if (url.includes('/UserByScreenName')) {
      return createFollowersLookupResponse();
    }

    timelineRequestCount += 1;
    throw new Error('timeline fetch should not run when the ready queue is already full');
  }

  const preview = await scanFollowersForBlocking({
    blockLimit: 2,
    resumeState,
    scanLimit: 10
  }, {
    documentRef: createFollowersScanDocument(),
    fetchImpl,
    queryIds: ['followersWorkingQueryId'],
    userLookupQueryIds: ['workingUserLookup']
  });

  assert.equal(timelineRequestCount, 0);
  assert.equal(preview.scannedCount, 0);
  assert.equal(preview.readyCount, 0);
  assert.equal(preview.alreadyBlockedCount, 0);
  assert.deepEqual(preview.resumeState, resumeState);
});

test('scanFollowersForBlocking consumes pending users before fetching resumeState.nextCursor', async () => {
  const requestedCursors = [];

  async function fetchImpl(url) {
    if (url.includes('/UserByScreenName')) {
      return createFollowersLookupResponse();
    }

    requestedCursors.push(JSON.parse(new URL(url).searchParams.get('variables')).cursor);
    return createFollowersTimelineResponse([
      createFollowersUserEntry('Dave', '404')
    ]);
  }

  const preview = await scanFollowersForBlocking({
    blockLimit: 10,
    resumeState: {
      hasMorePages: true,
      nextCursor: 'cursor-resume',
      pendingUsers: [{ restId: '303', username: 'charlie', blocking: false }]
    },
    scanLimit: 10
  }, {
    documentRef: createFollowersScanDocument(),
    fetchImpl,
    queryIds: ['followersWorkingQueryId'],
    userLookupQueryIds: ['workingUserLookup']
  });

  assert.deepEqual(requestedCursors, ['cursor-resume']);
  assert.equal(preview.scannedCount, 2);
  assert.deepEqual(preview.candidates, [
    { restId: '303', username: 'charlie' },
    { restId: '404', username: 'dave' }
  ]);
  assert.deepEqual(preview.resumeState, {
    nextCursor: null,
    pendingUsers: [],
    alreadyBlockedKeys: [],
    hasMorePages: false
  });
});

test('scanFollowersForBlocking seeds duplicate protection from existingReadyKeys and existingReadyCount', async () => {
  async function fetchImpl(url) {
    if (url.includes('/UserByScreenName')) {
      return createFollowersLookupResponse();
    }

    return createFollowersTimelineResponse([
      createFollowersUserEntry('Alice', '101'),
      createFollowersUserEntry('Bob', '202'),
      createFollowersBottomCursorEntry('cursor-bottom')
    ]);
  }

  const preview = await scanFollowersForBlocking({
    blockLimit: 2,
    resumeState: {
      existingReadyCount: 1,
      existingReadyKeys: ['id:101', 'username:alice'],
      hasMorePages: true
    },
    scanLimit: 10
  }, {
    documentRef: createFollowersScanDocument(),
    fetchImpl,
    queryIds: ['followersWorkingQueryId'],
    userLookupQueryIds: ['workingUserLookup']
  });

  assert.equal(preview.scannedCount, 2);
  assert.equal(preview.readyCount, 1);
  assert.equal(preview.stoppedByBlockLimit, true);
  assert.deepEqual(preview.candidates, [
    { restId: '202', username: 'bob' }
  ]);
  assert.deepEqual(preview.resumeState.pendingUsers, []);
});

test('scanFollowersForBlocking counts resumed blocking users without turning them into candidates and does not double count already blocked identities', async () => {
  let timelineRequestCount = 0;

  async function fetchImpl(url) {
    if (url.includes('/UserByScreenName')) {
      return createFollowersLookupResponse();
    }

    timelineRequestCount += 1;
    throw new Error('timeline fetch should not run after fully consuming pending users with hasMorePages=false');
  }

  const preview = await scanFollowersForBlocking({
    blockLimit: 10,
    resumeState: {
      alreadyBlockedKeys: ['id:301', 'username:alreadyblocked'],
      hasMorePages: false,
      pendingUsers: [
        { restId: '301', username: 'alreadyblocked', blocking: true },
        { restId: '202', username: 'bob', blocking: false }
      ]
    },
    scanLimit: 10
  }, {
    documentRef: createFollowersScanDocument(),
    fetchImpl,
    queryIds: ['followersWorkingQueryId'],
    userLookupQueryIds: ['workingUserLookup']
  });

  assert.equal(timelineRequestCount, 0);
  assert.equal(preview.scannedCount, 2);
  assert.equal(preview.alreadyBlockedCount, 0);
  assert.deepEqual(preview.candidates, [
    { restId: '202', username: 'bob' }
  ]);
  assert.deepEqual(preview.resumeState, {
    nextCursor: null,
    pendingUsers: [],
    alreadyBlockedKeys: ['id:301', 'username:alreadyblocked'],
    hasMorePages: false
  });
});

test('scanFollowersForBlocking does not fetch timeline pages when explicit resume state is fully drained', async () => {
  let timelineRequestCount = 0;

  async function fetchImpl(url) {
    if (url.includes('/UserByScreenName')) {
      return createFollowersLookupResponse();
    }

    timelineRequestCount += 1;
    throw new Error('timeline fetch should not run when the explicit resume state has no continuation left');
  }

  const preview = await scanFollowersForBlocking({
    blockLimit: 10,
    resumeState: {
      alreadyBlockedKeys: ['id:301'],
      hasMorePages: false,
      nextCursor: '   ',
      pendingUsers: []
    },
    scanLimit: 10
  }, {
    documentRef: createFollowersScanDocument(),
    fetchImpl,
    queryIds: ['followersWorkingQueryId'],
    userLookupQueryIds: ['workingUserLookup']
  });

  assert.equal(timelineRequestCount, 0);
  assert.equal(preview.scannedCount, 0);
  assert.equal(preview.readyCount, 0);
  assert.equal(preview.hasMorePages, false);
  assert.equal(preview.stoppedByBlockLimit, false);
  assert.equal(preview.stoppedByScanLimit, false);
  assert.deepEqual(preview.candidates, []);
  assert.deepEqual(preview.resumeState, {
    nextCursor: null,
    pendingUsers: [],
    alreadyBlockedKeys: ['id:301'],
    hasMorePages: false
  });
});

test('scanFollowersForBlocking resumes from resumeState.nextCursor', async () => {
  const requestedCursors = [];

  async function fetchImpl(url) {
    if (url.includes('/UserByScreenName')) {
      return createFollowersLookupResponse();
    }

    requestedCursors.push(JSON.parse(new URL(url).searchParams.get('variables')).cursor);
    return createFollowersTimelineResponse([
      createFollowersUserEntry('Alice', '101')
    ]);
  }

  await scanFollowersForBlocking({
    blockLimit: 10,
    resumeState: {
      hasMorePages: true,
      nextCursor: 'resume-cursor'
    },
    scanLimit: 10
  }, {
    documentRef: createFollowersScanDocument(),
    fetchImpl,
    queryIds: ['followersWorkingQueryId'],
    userLookupQueryIds: ['workingUserLookup']
  });

  assert.deepEqual(requestedCursors, ['resume-cursor']);
});

test('scanFollowersForBlocking uses Following operation for the following source', async () => {
  const requestedTimelineUrls = [];

  async function fetchImpl(url) {
    if (url.includes('/UserByScreenName')) {
      return {
        ok: true,
        async json() {
          return {
            data: {
              user: {
                result: {
                  rest_id: '1958695191897841664'
                }
              }
            }
          };
        }
      };
    }

    requestedTimelineUrls.push(url);

    return {
      ok: true,
      async json() {
        return {
          data: {
            user: {
              result: {
                timeline: {
                  timeline: {
                    instructions: [{
                      entries: [{
                        content: {
                          itemContent: {
                            user_results: {
                              result: {
                                core: { screen_name: 'FollowingUser' },
                                relationship_perspectives: { blocking: false },
                                rest_id: '2022820425018011648'
                              }
                            }
                          }
                        }
                      }]
                    }]
                  }
                }
              }
            }
          }
        };
      }
    };
  }

  const preview = await scanFollowersForBlocking({
    blockLimit: 10,
    scanLimit: 5,
    source: 'following'
  }, {
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: {
        origin: 'https://x.com',
        pathname: '/targetuser/following'
      }
    },
    fetchImpl,
    queryIds: ['followingWorkingQueryId'],
    userLookupQueryIds: ['workingUserLookup']
  });

  assert.equal(preview.source, 'following');
  assert.equal(preview.readyCount, 1);
  assert.equal(requestedTimelineUrls.length, 1);
  assert.equal(requestedTimelineUrls[0].includes('/followingWorkingQueryId/Following?'), true);
  assert.deepEqual(preview.candidates, [
    { restId: '2022820425018011648', username: 'followinguser' }
  ]);
});

test('scanFollowersForBlocking continues after an empty cursor page when another page is available', async () => {
  const requestedTimelineUrls = [];
  let timelineRequestCount = 0;

  async function fetchImpl(url) {
    if (url.includes('/UserByScreenName')) {
      return {
        ok: true,
        async json() {
          return {
            data: {
              user: {
                result: {
                  rest_id: '999'
                }
              }
            }
          };
        }
      };
    }

    requestedTimelineUrls.push(url);
    timelineRequestCount += 1;

    if (timelineRequestCount === 1) {
      return {
        ok: true,
        async json() {
          return {
            data: {
              user: {
                result: {
                  timeline: {
                    timeline: {
                      instructions: [{
                        entries: [{
                          content: {
                            cursorType: 'Bottom',
                            value: 'cursor-bottom'
                          }
                        }]
                      }]
                    }
                  }
                }
              }
            }
          };
        }
      };
    }

    return {
      ok: true,
      async json() {
        return {
          data: {
            user: {
              result: {
                timeline: {
                  timeline: {
                    instructions: [{
                      entries: [{
                        content: {
                          itemContent: {
                            user_results: {
                              result: {
                                core: { screen_name: 'Alice' },
                                relationship_perspectives: { blocking: false },
                                rest_id: '101'
                              }
                            }
                          }
                        }
                      }]
                    }]
                  }
                }
              }
            }
          }
        };
      }
    };
  }

  const preview = await scanFollowersForBlocking({
    blockLimit: 10,
    scanLimit: 5
  }, {
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: {
        origin: 'https://x.com',
        pathname: '/targetuser/followers'
      }
    },
    fetchImpl,
    queryIds: ['followersWorkingQueryId'],
    userLookupQueryIds: ['workingUserLookup']
  });

  assert.equal(preview.readyCount, 1);
  assert.equal(preview.scannedCount, 1);
  assert.equal(preview.hasMorePages, false);
  assert.equal(requestedTimelineUrls.length, 2);
  assert.equal(JSON.parse(new URL(requestedTimelineUrls[1]).searchParams.get('variables')).cursor, 'cursor-bottom');
  assert.deepEqual(preview.candidates, [
    { restId: '101', username: 'alice' }
  ]);
});

test('scanFollowersForBlocking resets the empty-page streak after a non-empty page', async () => {
  const requestedTimelineUrls = [];
  let timelineRequestCount = 0;

  async function fetchImpl(url) {
    if (url.includes('/UserByScreenName')) {
      return {
        ok: true,
        async json() {
          return {
            data: {
              user: {
                result: {
                  rest_id: '999'
                }
              }
            }
          };
        }
      };
    }

    requestedTimelineUrls.push(url);
    timelineRequestCount += 1;

    if (timelineRequestCount === 2) {
      return {
        ok: true,
        async json() {
          return {
            data: {
              user: {
                result: {
                  timeline: {
                    timeline: {
                      instructions: [{
                        entries: [
                          {
                            content: {
                              itemContent: {
                                user_results: {
                                  result: {
                                    core: { screen_name: 'Alice' },
                                    relationship_perspectives: { blocking: false },
                                    rest_id: '101'
                                  }
                                }
                              }
                            }
                          },
                          {
                            content: {
                              cursorType: 'Bottom',
                              value: 'cursor-bottom-2'
                            }
                          }
                        ]
                      }]
                    }
                  }
                }
              }
            }
          };
        }
      };
    }

    return {
      ok: true,
      async json() {
        return {
          data: {
            user: {
              result: {
                timeline: {
                  timeline: {
                    instructions: [{
                      entries: [{
                        content: {
                          cursorType: 'Bottom',
                          value: `cursor-bottom-${timelineRequestCount}`
                        }
                      }]
                    }]
                  }
                }
              }
            }
          }
        };
      }
    };
  }

  const preview = await scanFollowersForBlocking({
    blockLimit: 10,
    scanLimit: 5
  }, {
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: {
        origin: 'https://x.com',
        pathname: '/targetuser/followers'
      }
    },
    fetchImpl,
    queryIds: ['followersWorkingQueryId'],
    userLookupQueryIds: ['workingUserLookup']
  });

  assert.equal(preview.readyCount, 1);
  assert.equal(preview.scannedCount, 1);
  assert.equal(preview.hasMorePages, true);
  assert.equal(requestedTimelineUrls.length, 4);
  assert.deepEqual(preview.candidates, [
    { restId: '101', username: 'alice' }
  ]);
});

test('blockUserByScreenNameViaApi resolves rest_id and posts block request', async () => {
  const requestedUrls = [];

  async function fetchImpl(url, options = {}) {
    requestedUrls.push({ options, url });

    if (options.method === 'POST') {
      return {
        ok: true,
        async json() {
          return { ok: true };
        }
      };
    }

    return {
      ok: true,
      async json() {
        return {
          data: {
            user: {
              result: {
                rest_id: '2057563419742486528'
              }
            }
          }
        };
      }
    };
  }

  const result = await blockUserByScreenNameViaApi('Felixmfdo', {
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    fetchImpl,
    queryIds: ['workingQueryId']
  });

  assert.equal(result.restId, '2057563419742486528');
  assert.equal(result.screenName, 'felixmfdo');
  assert.equal(requestedUrls.length, 2);
  assert.equal(requestedUrls[0].url.includes('/workingQueryId/UserByScreenName'), true);
  assert.equal(requestedUrls[1].url.endsWith('/i/api/1.1/blocks/create.json'), true);
  assert.equal(requestedUrls[1].options.method, 'POST');
  assert.equal(requestedUrls[1].options.body, 'user_id=2057563419742486528');
});

test('unblockUserByScreenNameViaApi resolves rest_id and posts unblock request', async () => {
  const requestedUrls = [];

  async function fetchImpl(url, options = {}) {
    requestedUrls.push({ options, url });

    if (options.method === 'POST') {
      return {
        ok: true,
        async json() {
          return { ok: true };
        }
      };
    }

    return {
      ok: true,
      async json() {
        return {
          data: {
            user: {
              result: {
                rest_id: '2057563419742486528'
              }
            }
          }
        };
      }
    };
  }

  const result = await unblockUserByScreenNameViaApi('Felixmfdo', {
    cache: new Map(),
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    fetchImpl,
    queryIds: ['workingQueryId']
  });

  assert.equal(result.restId, '2057563419742486528');
  assert.equal(result.screenName, 'felixmfdo');
  assert.equal(requestedUrls.length, 2);
  assert.equal(requestedUrls[0].url.includes('/workingQueryId/UserByScreenName'), true);
  assert.equal(requestedUrls[1].url.endsWith('/i/api/1.1/blocks/destroy.json'), true);
  assert.equal(requestedUrls[1].options.method, 'POST');
  assert.equal(requestedUrls[1].options.body, 'user_id=2057563419742486528');
});

test('blockUserByRestIdViaApi posts the block request directly without a lookup', async () => {
  const requestedUrls = [];

  async function fetchImpl(url, options = {}) {
    requestedUrls.push({ options, url });
    return {
      ok: true,
      async json() {
        return { ok: true };
      }
    };
  }

  const result = await blockUserByRestIdViaApi('2057563419742486528', {
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    fetchImpl,
    screenName: 'Felixmfdo'
  });

  assert.equal(result.restId, '2057563419742486528');
  assert.equal(result.screenName, 'felixmfdo');
  assert.equal(requestedUrls.length, 1);
  assert.equal(requestedUrls[0].url.endsWith('/i/api/1.1/blocks/create.json'), true);
  assert.equal(requestedUrls[0].options.body, 'user_id=2057563419742486528');
});

test('unblockUserByRestIdViaApi posts the unblock request directly without a lookup', async () => {
  const requestedUrls = [];

  async function fetchImpl(url, options = {}) {
    requestedUrls.push({ options, url });
    return {
      ok: true,
      async json() {
        return { ok: true };
      }
    };
  }

  const result = await unblockUserByRestIdViaApi('2057563419742486528', {
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    fetchImpl,
    screenName: 'Felixmfdo'
  });

  assert.equal(result.restId, '2057563419742486528');
  assert.equal(result.screenName, 'felixmfdo');
  assert.equal(requestedUrls.length, 1);
  assert.equal(requestedUrls[0].url.endsWith('/i/api/1.1/blocks/destroy.json'), true);
  assert.equal(requestedUrls[0].options.body, 'user_id=2057563419742486528');
});

test('blockUserByRestIdViaApi includes generated x-client-transaction-id when available', async (t) => {
  const requestedHeaders = [];
  const originalGenerator = globalThis.EasyTweetBlockContent.tryGenerateXClientTransactionId;

  t.after(() => {
    globalThis.EasyTweetBlockContent.tryGenerateXClientTransactionId = originalGenerator;
  });

  globalThis.EasyTweetBlockContent.tryGenerateXClientTransactionId = async (method, path) => {
    assert.equal(method, 'POST');
    assert.equal(path, '/i/api/1.1/blocks/create.json');
    return 'generated-transaction-id';
  };

  async function fetchImpl(_url, options = {}) {
    requestedHeaders.push(options.headers || {});
    return {
      ok: true,
      async json() {
        return { ok: true };
      }
    };
  }

  await blockUserByRestIdViaApi('2057563419742486528', {
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    fetchImpl,
    screenName: 'Felixmfdo'
  });

  assert.equal(requestedHeaders[0]['x-client-transaction-id'], 'generated-transaction-id');
});

test('unblockUserByRestIdViaApi includes generated x-client-transaction-id when available', async (t) => {
  const requestedHeaders = [];
  const originalGenerator = globalThis.EasyTweetBlockContent.tryGenerateXClientTransactionId;

  t.after(() => {
    globalThis.EasyTweetBlockContent.tryGenerateXClientTransactionId = originalGenerator;
  });

  globalThis.EasyTweetBlockContent.tryGenerateXClientTransactionId = async (method, path) => {
    assert.equal(method, 'POST');
    assert.equal(path, '/i/api/1.1/blocks/destroy.json');
    return 'generated-unblock-transaction-id';
  };

  async function fetchImpl(_url, options = {}) {
    requestedHeaders.push(options.headers || {});
    return {
      ok: true,
      async json() {
        return { ok: true };
      }
    };
  }

  await unblockUserByRestIdViaApi('2057563419742486528', {
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    fetchImpl,
    screenName: 'Felixmfdo'
  });

  assert.equal(requestedHeaders[0]['x-client-transaction-id'], 'generated-unblock-transaction-id');
});

test('blockUserByScreenNameViaApi tolerates block responses without JSON bodies', async () => {
  async function fetchImpl(url, options = {}) {
    if (options.method === 'POST') {
      return {
        ok: true,
        async json() {
          throw new Error('no JSON body');
        }
      };
    }

    return {
      ok: true,
      async json() {
        return {
          data: {
            user: {
              result: {
                rest_id: '2057563419742486528'
              }
            }
          }
        };
      }
    };
  }

  const result = await blockUserByScreenNameViaApi('Felixmfdo', {
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    fetchImpl,
    queryIds: ['workingQueryId']
  });

  assert.equal(result.payload, null);
  assert.equal(result.restId, '2057563419742486528');
});

test('blockUsernamesViaApi blocks usernames sequentially and returns per-user results', async () => {
  const sleepCalls = [];

  async function fetchImpl(url, options = {}) {
    if (options.method === 'POST') {
      if (options.body === 'user_id=111') {
        return {
          ok: true,
          async json() {
            return { ok: true };
          }
        };
      }

      return {
        ok: false,
        status: 403,
        async text() {
          return 'forbidden';
        }
      };
    }

    if (url.includes('firstuser')) {
      return {
        ok: true,
        async json() {
          return {
            data: {
              user: {
                result: {
                  rest_id: '111'
                }
              }
            }
          };
        }
      };
    }

    return {
      ok: true,
      async json() {
        return {
          data: {
            user: {
              result: {
                rest_id: '222'
              }
            }
          }
        };
      }
    };
  }

  const results = await blockUsernamesViaApi(['@FirstUser', 'SecondUser', '@FirstUser'], {
    delayMs: 1200,
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    fetchImpl,
    queryIds: ['workingQueryId'],
    sleepImpl: async (delayMs) => {
      sleepCalls.push(delayMs);
    }
  });

  assert.deepEqual(results.map((entry) => entry.username), ['firstuser', 'seconduser']);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.equal(results[1].error.includes('Block API failed with 403'), true);
  assert.deepEqual(sleepCalls, [1200]);
});

test('blockUsernamesViaApi aborts the batch when canceled during the inter-user delay', async () => {
  const controller = new AbortController();
  const abortError = new Error('Immediate block canceled.');
  abortError.name = 'AbortError';
  const requestedUrls = [];
  const sleepCalls = [];

  async function fetchImpl(url, options = {}) {
    requestedUrls.push({ options, url });

    if (options.method === 'POST') {
      return {
        ok: true,
        async json() {
          return { ok: true };
        }
      };
    }

    return {
      ok: true,
      async json() {
        return {
          data: {
            user: {
              result: {
                rest_id: '111'
              }
            }
          }
        };
      }
    };
  }

  await assert.rejects(async () => blockUsernamesViaApi(['FirstUser', 'SecondUser'], {
    delayMs: 1000,
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    fetchImpl,
    queryIds: ['workingQueryId'],
    signal: controller.signal,
    sleepImpl: async (delayMs) => {
      sleepCalls.push(delayMs);
      controller.abort(abortError);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }), (error) => error?.name === 'AbortError' && error.message === 'Immediate block canceled.');

  assert.equal(requestedUrls.filter((entry) => entry.options.method === 'POST').length, 1);
  assert.deepEqual(sleepCalls, [1000]);
});

test('blockFollowerCandidatesViaApi deduplicates candidates and uses rest_id when available', async () => {
  const progressEvents = [];
  const sleepCalls = [];
  const requestedUrls = [];

  async function fetchImpl(url, options = {}) {
    requestedUrls.push({ options, url });

    if (options.method === 'POST') {
      return {
        ok: true,
        async json() {
          return { ok: true };
        }
      };
    }

    return {
      ok: true,
      async json() {
        return {
          data: {
            user: {
              result: {
                rest_id: '222'
              }
            }
          }
        };
      }
    };
  }

  const results = await blockFollowerCandidatesViaApi([
    { restId: '111', username: 'Alice' },
    { restId: '111', username: 'AliceAgain' },
    { username: 'Bob' }
  ], {
    delayMs: 1300,
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    fetchImpl,
    onProgress(progress) {
      progressEvents.push(progress);
    },
    queryIds: ['workingQueryId'],
    sleepImpl: async (delayMs) => {
      sleepCalls.push(delayMs);
    }
  });

  assert.deepEqual(results, [
    { ok: true, restId: '111', username: 'alice' },
    { ok: true, restId: '222', username: 'bob' }
  ]);
  assert.equal(requestedUrls.filter((entry) => entry.options.method === 'POST').length, 2);
  assert.equal(requestedUrls.some((entry) => entry.url.includes('/UserByScreenName')), true);
  assert.deepEqual(sleepCalls, [1300]);
  assert.deepEqual(progressEvents.map((event) => event.phase), [
    'started',
    'blocking',
    'blocked',
    'waiting',
    'blocking',
    'blocked',
    'finished'
  ]);
  assert.equal(progressEvents[0].delayMs, 1300);
  assert.equal(progressEvents.at(-1).successCount, 2);
  assert.equal(progressEvents.at(-1).failureCount, 0);
});

test('blockFollowerCandidatesViaApi aborts remaining candidates when canceled during delay', async () => {
  const controller = new AbortController();
  const abortError = new Error('Follower run canceled.');
  abortError.name = 'AbortError';
  const requestedUrls = [];
  const sleepCalls = [];

  async function fetchImpl(url, options = {}) {
    requestedUrls.push({ options, url });

    return {
      ok: true,
      async json() {
        return { ok: true };
      }
    };
  }

  await assert.rejects(async () => blockFollowerCandidatesViaApi([
    { restId: '111', username: 'Alice' },
    { restId: '222', username: 'Bob' }
  ], {
    delayMs: 1000,
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    fetchImpl,
    signal: controller.signal,
    sleepImpl: async (delayMs) => {
      sleepCalls.push(delayMs);
      controller.abort(abortError);
      return new Promise(() => {});
    }
  }), (error) => error?.name === 'AbortError' && error.message === 'Follower run canceled.');

  assert.equal(requestedUrls.filter((entry) => entry.options.method === 'POST').length, 1);
  assert.deepEqual(sleepCalls, [1000]);
});

test('scanFollowersForBlocking rejects before network work when already canceled', async () => {
  const controller = new AbortController();
  const abortError = new Error('Follower run canceled.');
  abortError.name = 'AbortError';
  let fetchCount = 0;
  controller.abort(abortError);

  await assert.rejects(async () => scanFollowersForBlocking({
    blockLimit: 2,
    scanLimit: 10
  }, {
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: {
        origin: 'https://x.com',
        pathname: '/targetuser/followers'
      }
    },
    fetchImpl: async () => {
      fetchCount += 1;
      return { ok: false };
    },
    signal: controller.signal
  }), (error) => error?.name === 'AbortError' && error.message === 'Follower run canceled.');

  assert.equal(fetchCount, 0);
});

test('normalizeBatchBlockDelayMs clamps values into the supported range', () => {
  assert.equal(normalizeBatchBlockDelayMs(undefined), DEFAULT_BATCH_BLOCK_DELAY_MS);
  assert.equal(normalizeBatchBlockDelayMs(250), MIN_BATCH_BLOCK_DELAY_MS);
  assert.equal(normalizeBatchBlockDelayMs(1250), 1250);
  assert.equal(normalizeBatchBlockDelayMs(10500), MAX_BATCH_BLOCK_DELAY_MS);
});

test('content sleep delegates to the shared followers sleep helper', async (t) => {
  const originalFollowersApi = globalThis.EasyTweetBlockFollowers;
  const calls = [];
  const setTimeoutImpl = () => 0;

  globalThis.EasyTweetBlockFollowers = {
    ...(originalFollowersApi || {}),
    sleep(delayMs, providedSetTimeoutImpl) {
      calls.push({ delayMs, setTimeoutImpl: providedSetTimeoutImpl });
      return Promise.resolve('delegated-sleep');
    }
  };

  t.after(() => {
    globalThis.EasyTweetBlockFollowers = originalFollowersApi;
  });

  const result = await sleep(25, setTimeoutImpl);

  assert.equal(result, 'delegated-sleep');
  assert.deepEqual(calls, [{ delayMs: 25, setTimeoutImpl }]);
});

test('normalizePageBlockButtonStyle defaults to icon and accepts the text variant', () => {
  assert.equal(normalizePageBlockButtonStyle(undefined), DEFAULT_PAGE_BLOCK_BUTTON_STYLE);
  assert.equal(normalizePageBlockButtonStyle('text'), PAGE_BLOCK_BUTTON_STYLES.text);
  assert.equal(normalizePageBlockButtonStyle('something-else'), PAGE_BLOCK_BUTTON_STYLES.icon);
});

test('syncStoredPageButtonStyle and observeStoredPageButtonStyle apply saved native button styles per surface', async () => {
  const listeners = [];
  const tweetButton = createDomElement({
    dataset: {
      kind: BUTTON_KINDS.native,
      surface: PAGE_BUTTON_STYLE_SURFACES.tweet,
      screenName: 'Felixmfdo',
      state: 'idle'
    }
  });
  const profileButton = createDomElement({
    dataset: {
      kind: BUTTON_KINDS.native,
      surface: PAGE_BUTTON_STYLE_SURFACES.profile,
      screenName: 'Felixmfdo',
      state: 'idle'
    }
  });
  const userCellButton = createDomElement({
    dataset: {
      kind: BUTTON_KINDS.native,
      surface: PAGE_BUTTON_STYLE_SURFACES.userCell,
      screenName: 'Felixmfdo',
      state: 'idle'
    }
  });
  const globalRef = {
    chrome: {
      runtime: {
        lastError: null
      },
      storage: {
        local: {
          get(_keys, callback) {
            callback({
              [PAGE_BLOCK_BUTTON_STYLES_STORAGE_KEY]: {
                [PAGE_BUTTON_STYLE_SURFACES.tweet]: PAGE_BLOCK_BUTTON_STYLES.text,
                [PAGE_BUTTON_STYLE_SURFACES.profile]: PAGE_BLOCK_BUTTON_STYLES.icon,
                [PAGE_BUTTON_STYLE_SURFACES.userCell]: PAGE_BLOCK_BUTTON_STYLES.text
              }
            });
          }
        },
        onChanged: {
          addListener(listener) {
            listeners.push(listener);
          },
          removeListener() {}
        }
      }
    },
    document: {
      querySelectorAll(selector) {
        return selector === `[${BLOCK_BUTTON_ATTRIBUTE}][data-kind="native"]`
          ? [tweetButton, profileButton, userCellButton]
          : [];
      }
    }
  };

  await syncStoredPageButtonStyle(globalRef);
  assert.equal(tweetButton.dataset.displayStyle, PAGE_BLOCK_BUTTON_STYLES.text);
  assert.equal(tweetButton.textContent, 'Block');
  assert.equal(profileButton.dataset.displayStyle, PAGE_BLOCK_BUTTON_STYLES.icon);
  assert.equal(profileButton.innerHTML.includes('<svg'), true);
  assert.equal(userCellButton.dataset.displayStyle, PAGE_BLOCK_BUTTON_STYLES.text);
  assert.equal(userCellButton.textContent, 'Block');

  observeStoredPageButtonStyle(globalRef);
  listeners[0]({
    [PAGE_BLOCK_BUTTON_STYLES_STORAGE_KEY]: {
      newValue: {
        [PAGE_BUTTON_STYLE_SURFACES.tweet]: PAGE_BLOCK_BUTTON_STYLES.icon,
        [PAGE_BUTTON_STYLE_SURFACES.profile]: PAGE_BLOCK_BUTTON_STYLES.text,
        [PAGE_BUTTON_STYLE_SURFACES.userCell]: PAGE_BLOCK_BUTTON_STYLES.icon
      }
    }
  }, 'local');

  assert.equal(tweetButton.dataset.displayStyle, PAGE_BLOCK_BUTTON_STYLES.icon);
  assert.equal(tweetButton.innerHTML.includes('<svg'), true);
  assert.equal(profileButton.dataset.displayStyle, PAGE_BLOCK_BUTTON_STYLES.text);
  assert.equal(profileButton.textContent, 'Block');
  assert.equal(userCellButton.dataset.displayStyle, PAGE_BLOCK_BUTTON_STYLES.icon);
  assert.equal(userCellButton.innerHTML.includes('<svg'), true);
});

test('syncStoredUserCellAddButtonVisibility and observeStoredUserCellAddButtonVisibility hide and show Add buttons', async () => {
  const listeners = [];
  const button = createDomElement({
    dataset: {
      action: BUTTON_ACTIONS.saveToList,
      easyTweetblockAction: BUTTON_ACTIONS.saveToList,
      surface: 'user-cell'
    }
  });
  button.setAttribute(BUTTON_ACTION_ATTRIBUTE, BUTTON_ACTIONS.saveToList);
  const globalRef = {
    chrome: {
      runtime: {
        lastError: null
      },
      storage: {
        local: {
          get(_keys, callback) {
            callback({
              [sharedSettings.USER_CELL_ADD_BUTTON_VISIBILITY_STORAGE_KEY]: false
            });
          }
        },
        onChanged: {
          addListener(listener) {
            listeners.push(listener);
          },
          removeListener() {}
        }
      }
    },
    document: {
      querySelectorAll(selector) {
        return selector === `[${BLOCK_BUTTON_ATTRIBUTE}][${BUTTON_ACTION_ATTRIBUTE}="${BUTTON_ACTIONS.saveToList}"]` ? [button] : [];
      }
    }
  };

  await syncStoredUserCellAddButtonVisibility(globalRef);
  assert.equal(button.hidden, true);

  observeStoredUserCellAddButtonVisibility(globalRef);
  listeners[0]({
    [sharedSettings.USER_CELL_ADD_BUTTON_VISIBILITY_STORAGE_KEY]: {
      newValue: true
    }
  }, 'local');

  assert.equal(button.hidden, false);
});

test('syncStoredUserCellAddButtonStyle and observeStoredUserCellAddButtonStyle update Add buttons', async () => {
  const listeners = [];
  const button = createDomElement({
    dataset: {
      action: BUTTON_ACTIONS.saveToList,
      easyTweetblockAction: BUTTON_ACTIONS.saveToList,
      screenName: 'Felixmfdo',
      surface: 'user-cell'
    }
  });
  button.setAttribute(BUTTON_ACTION_ATTRIBUTE, BUTTON_ACTIONS.saveToList);
  const globalRef = {
    chrome: {
      runtime: {
        lastError: null
      },
      storage: {
        local: {
          get(_keys, callback) {
            callback({
              [USER_CELL_ADD_BUTTON_STYLE_STORAGE_KEY]: PAGE_BLOCK_BUTTON_STYLES.text
            });
          }
        },
        onChanged: {
          addListener(listener) {
            listeners.push(listener);
          },
          removeListener() {}
        }
      }
    },
    document: {
      querySelectorAll(selector) {
        return selector === `[${BLOCK_BUTTON_ATTRIBUTE}][${BUTTON_ACTION_ATTRIBUTE}="${BUTTON_ACTIONS.saveToList}"]` ? [button] : [];
      }
    }
  };

  await syncStoredUserCellAddButtonStyle(globalRef);
  assert.equal(button.dataset.displayStyle, PAGE_BLOCK_BUTTON_STYLES.text);
  assert.equal(button.textContent, 'Add');

  observeStoredUserCellAddButtonStyle(globalRef);
  listeners[0]({
    [USER_CELL_ADD_BUTTON_STYLE_STORAGE_KEY]: {
      newValue: PAGE_BLOCK_BUTTON_STYLES.icon
    }
  }, 'local');

  assert.equal(button.dataset.displayStyle, PAGE_BLOCK_BUTTON_STYLES.icon);
  assert.equal(button.innerHTML.includes('<svg'), true);
});

test('stored setting observers ignore unrelated changes and unsubscribe listeners', () => {
  const listeners = new Set();
  const removedListeners = [];
  const queryCalls = [];
  const globalRef = {
    chrome: {
      storage: {
        onChanged: {
          addListener(listener) {
            listeners.add(listener);
          },
          removeListener(listener) {
            removedListeners.push(listener);
            listeners.delete(listener);
          }
        }
      }
    },
    document: {
      querySelectorAll(selector) {
        queryCalls.push(selector);
        return [];
      }
    }
  };

  const stopPageButtonStyle = observeStoredPageButtonStyle(globalRef);
  const stopAddButtonStyle = observeStoredUserCellAddButtonStyle(globalRef);
  const stopAddButtonVisibility = observeStoredUserCellAddButtonVisibility(globalRef);

  assert.equal(listeners.size, 3);

  for (const listener of listeners) {
    listener({ unrelated: { newValue: true } }, 'local');
    listener({
      [PAGE_BLOCK_BUTTON_STYLES_STORAGE_KEY]: { newValue: DEFAULT_PAGE_BLOCK_BUTTON_STYLES },
      [USER_CELL_ADD_BUTTON_STYLE_STORAGE_KEY]: { newValue: DEFAULT_USER_CELL_ADD_BUTTON_STYLE },
      [sharedSettings.USER_CELL_ADD_BUTTON_VISIBILITY_STORAGE_KEY]: { newValue: true }
    }, 'sync');
  }

  assert.deepEqual(queryCalls, []);

  for (const listener of listeners) {
    listener({
      [PAGE_BLOCK_BUTTON_STYLES_STORAGE_KEY]: { newValue: DEFAULT_PAGE_BLOCK_BUTTON_STYLES },
      [USER_CELL_ADD_BUTTON_STYLE_STORAGE_KEY]: { newValue: DEFAULT_USER_CELL_ADD_BUTTON_STYLE },
      [sharedSettings.USER_CELL_ADD_BUTTON_VISIBILITY_STORAGE_KEY]: { newValue: true }
    }, 'local');
  }

  assert.equal(queryCalls.length, 3);

  stopPageButtonStyle();
  stopAddButtonStyle();
  stopAddButtonVisibility();

  assert.equal(removedListeners.length, 3);
  assert.equal(listeners.size, 0);
});

test('normalizeUsername lowercases usernames for blocklist checks', () => {
  assert.equal(normalizeUsername('@Felixmfdo'), 'felixmfdo');
  assert.equal(normalizeUsername('/Felixmfdo'), 'felixmfdo');
  assert.equal(normalizeUsername('bad-name'), null);
  assert.equal(normalizeUsername(''), null);
});

test('createUsernameSet deduplicates and normalizes usernames', () => {
  const blocklistSet = createUsernameSet(['@Felixmfdo', 'spam_account', 'Felixmfdo', 'bad-name']);

  assert.equal(blocklistSet.has('felixmfdo'), true);
  assert.equal(blocklistSet.has('spam_account'), true);
  assert.equal(blocklistSet.has('bad-name'), false);
  assert.equal(blocklistSet.size, 2);
});

test('attachButtonToTweet inserts the native button into the first action wrapper and uses icon style by default', (t) => {
  const { createdElements, documentRef } = createDocumentStub();
  const { caretButton, leadingAction, leadingActionButton, localButtonGroup, parentElement, tweetNode } = createTweetNode();

  useGlobalOverrides(t, { document: documentRef });
  setCurrentNativeButtonStyle(PAGE_BLOCK_BUTTON_STYLES.icon);

  attachButtonToTweet(tweetNode);

  assert.equal(createdElements.length, 1);
  assert.equal(parentElement.children[0], leadingAction);
  assert.equal(leadingAction.children[0].dataset.kind, BUTTON_KINDS.native);
  assert.equal(leadingAction.children[0].dataset.displayStyle, PAGE_BLOCK_BUTTON_STYLES.icon);
  assert.equal(leadingAction.children[0].innerHTML.includes('<svg'), true);
  assert.equal(leadingAction.children[1], leadingActionButton);
  assert.equal(parentElement.children[1].querySelector('button'), caretButton);
  assert.equal(localButtonGroup.children[0], caretButton);

  attachButtonToTweet({
    querySelector(selector) {
      if (selector === `[${BLOCK_BUTTON_ATTRIBUTE}]`) {
        return {};
      }

      return selector === SELECTORS.caretButton ? caretButton : null;
    }
  });

  assert.equal(createdElements.length, 1);
});

test('attachButtonToTweet moves an existing native button into the Grok action wrapper', (t) => {
  const { createdElements, documentRef } = createDocumentStub();
  const { caretButton, leadingAction, localButtonGroup, tweetNode } = createTweetNode();
  const misplacedButton = createDomElement({
    nodeType: 1,
    tagName: 'BUTTON',
    matches(selector) {
      return selector === 'button' || selector === `[${BLOCK_BUTTON_ATTRIBUTE}]`;
    }
  });

  useGlobalOverrides(t, { document: documentRef });
  misplacedButton.setAttribute(BLOCK_BUTTON_ATTRIBUTE, 'true');
  localButtonGroup.insertBefore(misplacedButton, caretButton);

  attachButtonToTweet(tweetNode);

  assert.equal(createdElements.length, 0);
  assert.equal(leadingAction.children[0], misplacedButton);
  assert.equal(localButtonGroup.children[0], caretButton);
});

test('attachButtonToProfilePage inserts the native button before the profile actions trigger', (t) => {
  const { actionBar, createdElements, documentRef, moreButton, messageButton } = createProfilePageDocument('281v6s1b5z51');

  useGlobalOverrides(t, { document: documentRef });
  setCurrentNativeButtonStyle(PAGE_BLOCK_BUTTON_STYLES.icon);

  attachButtonToProfilePage(documentRef);

  assert.equal(createdElements.length, 1);
  assert.equal(actionBar.children[0].dataset.kind, BUTTON_KINDS.native);
  assert.equal(actionBar.children[0].dataset.screenName, '281v6s1b5z51');
  assert.equal(actionBar.children[1], moreButton);
  assert.equal(actionBar.children[2], messageButton);

  attachButtonToProfilePage(documentRef);

  assert.equal(createdElements.length, 1);
});

test('attachButtonToUserCell inserts list and block buttons into the follow action wrapper', (t) => {
  const { createdElements, documentRef } = createDocumentStub();
  const { actionRow, followButton, followButtonWrapper, userCell } = createUserCellNode('Milana62234788');

  useGlobalOverrides(t, { document: documentRef });
  setCurrentNativeButtonStyle(PAGE_BLOCK_BUTTON_STYLES.icon);

  attachButtonToUserCell(userCell, documentRef);

  assert.equal(createdElements.length, 2);
  assert.equal(actionRow.children[1], followButtonWrapper);
  assert.equal(followButtonWrapper.getAttribute('data-easy-tweetblock-user-cell-actions'), 'true');
  assert.equal(followButtonWrapper.children[0].dataset.easyTweetblockAction, BUTTON_ACTIONS.saveToList);
  assert.equal(followButtonWrapper.children[0].dataset.surface, 'user-cell');
  assert.equal(followButtonWrapper.children[0].dataset.screenName, 'Milana62234788');
  assert.equal(followButtonWrapper.children[1].dataset.easyTweetblockAction, BUTTON_ACTIONS.block);
  assert.equal(followButtonWrapper.children[1].dataset.kind, BUTTON_KINDS.native);
  assert.equal(followButtonWrapper.children[2], followButton);

  attachButtonToUserCell(userCell, documentRef);

  assert.equal(createdElements.length, 2);
  assert.equal(actionRow.children[1], followButtonWrapper);
  assert.equal(followButtonWrapper.children[0].dataset.easyTweetblockAction, BUTTON_ACTIONS.saveToList);
  assert.equal(followButtonWrapper.children[1].dataset.easyTweetblockAction, BUTTON_ACTIONS.block);
});

test('attachButtonToUserCell hides the custom block button when the native action is already blocked', (t) => {
  const { createdElements, documentRef } = createDocumentStub();
  const { followButton, followButtonWrapper, userCell } = createUserCellNode('Milana62234788');

  useGlobalOverrides(t, { document: documentRef });
  followButton.textContent = 'Blocked';

  attachButtonToUserCell(userCell, documentRef);
  const blockButton = followButtonWrapper.children[1];

  assert.equal(createdElements.length, 2);
  assert.equal(followButtonWrapper.children[0].dataset.easyTweetblockAction, BUTTON_ACTIONS.saveToList);
  assert.equal(followButtonWrapper.children[0].hidden, false);
  assert.equal(blockButton.dataset.easyTweetblockAction, BUTTON_ACTIONS.block);
  assert.equal(blockButton.hidden, true);

  attachButtonToUserCell(userCell, documentRef);

  assert.equal(createdElements.length, 2);
  assert.equal(blockButton.hidden, true);
});

test('new native block buttons use the configured style for each surface on creation', (t) => {
  const { documentRef } = createDocumentStub();
  const { tweetNode } = createTweetNode('TweetUser');
  const profilePage = createProfilePageDocument('ProfileUser');
  const { followButton, userCell } = createUserCellNode('CellUser');

  useGlobalOverrides(t, { document: documentRef });
  setCurrentNativeButtonStyles({
    [PAGE_BUTTON_STYLE_SURFACES.tweet]: PAGE_BLOCK_BUTTON_STYLES.text,
    [PAGE_BUTTON_STYLE_SURFACES.profile]: PAGE_BLOCK_BUTTON_STYLES.icon,
    [PAGE_BUTTON_STYLE_SURFACES.userCell]: PAGE_BLOCK_BUTTON_STYLES.text
  });
  t.after(() => {
    setCurrentNativeButtonStyles(DEFAULT_PAGE_BLOCK_BUTTON_STYLES);
  });

  const tweetButton = createNativeBlockButton(tweetNode, documentRef);
  const profileButton = createProfileBlockButton(profilePage.documentRef);
  const userCellButton = createUserCellBlockButton(userCell, {
    actionButton: followButton
  });

  assert.equal(tweetButton.dataset.displayStyle, PAGE_BLOCK_BUTTON_STYLES.text);
  assert.equal(tweetButton.textContent, 'Block');
  assert.equal(profileButton.dataset.displayStyle, PAGE_BLOCK_BUTTON_STYLES.icon);
  assert.equal(profileButton.innerHTML.includes('<svg'), true);
  assert.equal(userCellButton.dataset.displayStyle, PAGE_BLOCK_BUTTON_STYLES.text);
  assert.equal(userCellButton.textContent, 'Block');
});

test('createUserCellListButton toggles the username in the active list on repeated clicks', async (t) => {
  const { documentRef } = createDocumentStub();
  const { userCell } = createUserCellNode('Milana62234788');
  const extensionApi = createStorageExtensionApi({
    [sharedBlocklist.ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: 'blocklist',
    [sharedBlocklist.USERNAME_LISTS_STORAGE_KEY]: [{
      id: 'blocklist',
      name: 'Blocklist',
      usernames: []
    }]
  });

  useGlobalOverrides(t, { document: documentRef });
  setCurrentUserCellAddButtonStyle(PAGE_BLOCK_BUTTON_STYLES.text);
  t.after(() => {
    setCurrentUserCellAddButtonStyle(DEFAULT_USER_CELL_ADD_BUTTON_STYLE);
  });

  const button = createUserCellListButton(userCell, {
    documentRef,
    extensionApi
  });

  assert.equal(button.dataset.easyTweetblockAction, BUTTON_ACTIONS.saveToList);
  assert.equal(button.textContent, 'Add');

  button.click();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.deepEqual(extensionApi.store[sharedBlocklist.USERNAME_LISTS_STORAGE_KEY][0].usernames, ['milana62234788']);
  assert.equal(button.dataset.state, 'listed');
  assert.equal(button.textContent, 'Remove');

  button.click();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.deepEqual(extensionApi.store[sharedBlocklist.USERNAME_LISTS_STORAGE_KEY][0].usernames, []);
  assert.equal(button.dataset.state, 'idle');
  assert.equal(button.textContent, 'Add');
});

test('createUserCellListButton uses the configured Add button icon on creation and after saving', async (t) => {
  const { documentRef } = createDocumentStub();
  const { userCell } = createUserCellNode('Milana62234788');
  const extensionApi = createStorageExtensionApi({
    [sharedBlocklist.ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: 'blocklist',
    [sharedBlocklist.USERNAME_LISTS_STORAGE_KEY]: [{
      id: 'blocklist',
      name: 'Blocklist',
      usernames: []
    }]
  });

  useGlobalOverrides(t, { document: documentRef });
  setCurrentUserCellAddButtonStyle(PAGE_BLOCK_BUTTON_STYLES.icon);
  t.after(() => {
    setCurrentUserCellAddButtonStyle(DEFAULT_USER_CELL_ADD_BUTTON_STYLE);
  });

  const button = createUserCellListButton(userCell, {
    documentRef,
    extensionApi
  });

  assert.equal(button.dataset.displayStyle, PAGE_BLOCK_BUTTON_STYLES.icon);
  assert.equal(button.textContent, '');
  assert.equal(button.innerHTML.includes('M11.25 4.75'), true);

  button.click();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.deepEqual(extensionApi.store[sharedBlocklist.USERNAME_LISTS_STORAGE_KEY][0].usernames, ['milana62234788']);
  assert.equal(button.dataset.state, 'listed');
  assert.equal(button.innerHTML.includes('M9.55 16.94'), true);
});

test('createUserCellListButton keeps an unlisted button idle while hydrating the active list', async (t) => {
  const { documentRef } = createDocumentStub();
  const { userCell } = createUserCellNode('Aungko1531435');
  const extensionApi = createStorageExtensionApi({
    [sharedBlocklist.ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: 'blocklist',
    [sharedBlocklist.USERNAME_LISTS_STORAGE_KEY]: [{
      id: 'blocklist',
      name: 'Blocklist',
      usernames: []
    }]
  });

  useGlobalOverrides(t, { document: documentRef });
  setCurrentUserCellAddButtonStyle(PAGE_BLOCK_BUTTON_STYLES.icon);
  t.after(() => {
    setCurrentUserCellAddButtonStyle(DEFAULT_USER_CELL_ADD_BUTTON_STYLE);
  });

  const button = createUserCellListButton(userCell, {
    documentRef,
    extensionApi
  });

  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(button.dataset.state, 'idle');
  assert.equal(button.title, 'Add @Aungko1531435 to the active list');
  assert.equal(button.innerHTML.includes('M11.25 4.75'), true);
});

test('createUserCellListButton keeps remove retry semantics when removal fails', async (t) => {
  const { documentRef } = createDocumentStub();
  const { userCell } = createUserCellNode('Milana62234788');
  const extensionApi = createStorageExtensionApi({
    [sharedBlocklist.ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: 'blocklist',
    [sharedBlocklist.USERNAME_LISTS_STORAGE_KEY]: [{
      id: 'blocklist',
      name: 'Blocklist',
      usernames: ['milana62234788']
    }]
  });

  useGlobalOverrides(t, { document: documentRef });
  setCurrentUserCellAddButtonStyle(PAGE_BLOCK_BUTTON_STYLES.text);
  t.after(() => {
    setCurrentUserCellAddButtonStyle(DEFAULT_USER_CELL_ADD_BUTTON_STYLE);
  });

  const button = createUserCellListButton(userCell, {
    documentRef,
    extensionApi
  });
  await flushAsyncWork();

  assert.equal(button.dataset.state, 'listed');

  extensionApi.storage.local.set = () => Promise.reject(new Error('storage set failed'));

  button.click();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.deepEqual(extensionApi.store[sharedBlocklist.USERNAME_LISTS_STORAGE_KEY][0].usernames, ['milana62234788']);
  assert.equal(button.dataset.state, 'error-remove');
  assert.equal(button.textContent, 'Retry remove');
  assert.equal(button.title, 'Retry removing @Milana62234788 from the active list');
  assert.equal(button.disabled, false);
});

test('createUserCellListButton shares the initial active-list storage read', async (t) => {
  const { documentRef } = createDocumentStub();
  const firstUserCell = createUserCellNode('Alice').userCell;
  const secondUserCell = createUserCellNode('Bob').userCell;
  const extensionApi = createStorageExtensionApi({
    [sharedBlocklist.ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: 'blocklist',
    [sharedBlocklist.USERNAME_LISTS_STORAGE_KEY]: [{
      id: 'blocklist',
      name: 'Blocklist',
      usernames: ['bob']
    }]
  });
  const getFromStorage = extensionApi.storage.local.get.bind(extensionApi.storage.local);
  let storageGetCount = 0;
  extensionApi.storage.local.get = (keys) => {
    storageGetCount += 1;
    return getFromStorage(keys);
  };

  useGlobalOverrides(t, { document: documentRef });
  setCurrentUserCellAddButtonStyle(PAGE_BLOCK_BUTTON_STYLES.text);
  t.after(() => {
    setCurrentUserCellAddButtonStyle(DEFAULT_USER_CELL_ADD_BUTTON_STYLE);
  });

  const firstButton = createUserCellListButton(firstUserCell, {
    documentRef,
    extensionApi
  });
  const secondButton = createUserCellListButton(secondUserCell, {
    documentRef,
    extensionApi
  });
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(storageGetCount, 1);
  assert.equal(firstButton.dataset.state, 'idle');
  assert.equal(secondButton.dataset.state, 'listed');
});

test('collectTweets returns the root tweet and nested tweet descendants', () => {
  const nestedTweet = { id: 'nested' };
  const rootNode = {
    matches(selector) {
      return selector === SELECTORS.tweet;
    },
    querySelectorAll(selector) {
      return selector === SELECTORS.tweet ? [nestedTweet] : [];
    }
  };

  assert.deepEqual(collectTweets(rootNode), [rootNode, nestedTweet]);
  assert.deepEqual(collectTweets({}), []);
});

test('collectUserCells returns the root user cell and nested user cell descendants', () => {
  const nestedUserCell = { id: 'nested-user-cell' };
  const rootNode = {
    matches(selector) {
      return selector === SELECTORS.userCell;
    },
    querySelectorAll(selector) {
      return selector === SELECTORS.userCell ? [nestedUserCell] : [];
    }
  };

  assert.deepEqual(collectUserCells(rootNode), [rootNode, nestedUserCell]);
  assert.deepEqual(collectUserCells({}), []);
});

test('collectTweets does not promote arbitrary descendant mutations to tweets', () => {
  const tweetNode = {
    matches(selector) {
      return selector === SELECTORS.tweet;
    },
    querySelectorAll() {
      return [];
    }
  };
  const descendant = {
    nodeType: 1,
    parentElement: tweetNode,
    querySelectorAll() {
      return [];
    }
  };

  assert.deepEqual(collectTweets(descendant), []);
});

test('processNode promotes nested follow-button mutations back to the parent user cell', (t) => {
  const { createdElements, documentRef } = createDocumentStub();
  const { actionRow, followButton, followButtonWrapper, userCell } = createUserCellNode('Milana62234788');

  useGlobalOverrides(t, { document: documentRef });
  setCurrentNativeButtonStyle(PAGE_BLOCK_BUTTON_STYLES.icon);

  processNode(followButton, documentRef);

  assert.equal(createdElements.length, 2);
  assert.equal(actionRow.children[1], followButtonWrapper);
  assert.equal(followButtonWrapper.getAttribute('data-easy-tweetblock-user-cell-actions'), 'true');
  assert.equal(followButtonWrapper.children[0].dataset.easyTweetblockAction, BUTTON_ACTIONS.saveToList);
  assert.equal(followButtonWrapper.children[1].dataset.easyTweetblockAction, BUTTON_ACTIONS.block);
  assert.equal(followButton.parentElement, followButtonWrapper);
  assert.equal(userCell.children[0], actionRow);
});

test('createApiBlockButton marks success after a completed API block', async (t) => {
  const { documentRef } = createDocumentStub();
  const { tweetNode } = createTweetNode('Felixmfdo');

  useGlobalOverrides(t, { document: documentRef });

  const button = createApiBlockButton(tweetNode, {
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    async fetchImpl(url, options = {}) {
      if (options.method === 'POST') {
        return {
          ok: true,
          async json() {
            return { ok: true };
          }
        };
      }

      return {
        ok: true,
        async json() {
          return {
            data: {
              user: {
                result: {
                  rest_id: '111'
                }
              }
            }
          };
        }
      };
    },
    queryIds: ['workingQueryId']
  });

  button.click();
  await flushAsyncWork();

  assert.equal(button.dataset.state, 'success');
  assert.equal(button.textContent, 'API ok');
});

test('createApiBlockButton marks errors as retryable when the API flow fails', async (t) => {
  const { documentRef } = createDocumentStub();
  const { tweetNode } = createTweetNode('Felixmfdo', {
    includePermalink: false
  });
  const originalWarn = console.warn;

  useGlobalOverrides(t, { document: documentRef });
  console.warn = () => {};

  t.after(() => {
    console.warn = originalWarn;
  });

  const button = createApiBlockButton(tweetNode, {
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    }
  });

  button.click();
  await flushAsyncWork();

  assert.equal(button.dataset.state, 'error');
  assert.equal(button.textContent, 'Retry');
});

test('createUserCellBlockButton supports unblock and restores the native follow action', async (t) => {
  const { documentRef } = createDocumentStub();
  const { followButton, userCell } = createUserCellNode('Felixmfdo');
  const requestedUrls = [];

  useGlobalOverrides(t, { document: documentRef });
  setCurrentNativeButtonStyle(PAGE_BLOCK_BUTTON_STYLES.text);
  t.after(() => {
    setCurrentNativeButtonStyle(PAGE_BLOCK_BUTTON_STYLES.icon);
  });

  const button = createUserCellBlockButton(userCell, {
    actionButton: followButton,
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    async fetchImpl(url, options = {}) {
      requestedUrls.push({ options, url });

      if (options.method === 'POST') {
        return {
          ok: true,
          async json() {
            return { ok: true };
          }
        };
      }

      return {
        ok: true,
        async json() {
          return {
            data: {
              user: {
                result: {
                  rest_id: '111'
                }
              }
            }
          };
        }
      };
    },
    cache: new Map(),
    queryIds: ['workingQueryId']
  });

  button.click();
  await flushAsyncWork();

  assert.equal(button.dataset.state, 'blocked');
  assert.equal(button.dataset.userCellBlockMode, 'unblock');
  assert.equal(button.dataset.userRestId, '111');
  assert.equal(followButton.hidden, true);
  assert.equal(followButton.style.display, 'none');

  button.dispatch('mouseenter');
  assert.equal(button.dataset.state, 'unblock');
  assert.equal(button.textContent, 'Unblock');

  button.click();
  await flushAsyncWork();

  assert.equal(button.dataset.state, 'idle');
  assert.equal(button.dataset.userCellBlockMode, 'block');
  assert.equal(button.dataset.userRestId, undefined);
  assert.equal(button.textContent, 'Block');
  assert.equal(followButton.hidden, false);
  assert.equal(followButton.style.display, '');
  assert.equal(requestedUrls.length, 3);
  assert.equal(requestedUrls[1].url.endsWith('/i/api/1.1/blocks/create.json'), true);
  assert.equal(requestedUrls[2].url.endsWith('/i/api/1.1/blocks/destroy.json'), true);
});

test('createUserCellBlockButton refuses to unblock when the user cell now shows a different user', async (t) => {
  const { documentRef } = createDocumentStub();
  const { followButton, userCell } = createUserCellNode('alice');
  const requestedUrls = [];

  useGlobalOverrides(t, { document: documentRef });
  setCurrentNativeButtonStyle(PAGE_BLOCK_BUTTON_STYLES.text);
  t.after(() => {
    setCurrentNativeButtonStyle(PAGE_BLOCK_BUTTON_STYLES.icon);
  });

  const button = createUserCellBlockButton(userCell, {
    actionButton: followButton,
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    async fetchImpl(url, options = {}) {
      requestedUrls.push({ options, url });

      if (options.method === 'POST') {
        return {
          ok: true,
          async json() {
            return { ok: true };
          }
        };
      }

      return {
        ok: true,
        async json() {
          return {
            data: {
              user: {
                result: {
                  rest_id: '111'
                }
              }
            }
          };
        }
      };
    },
    cache: new Map(),
    queryIds: ['workingQueryId']
  });

  button.click();
  await flushAsyncWork();
  assert.equal(button.dataset.state, 'blocked');
  assert.equal(button.dataset.userRestId, '111');

  // Simulate X recycling the cell for a different account while our button
  // (and its cached restId) survives on the reused DOM node.
  userCell.querySelector = (selector) => {
    if (selector === SELECTORS.profileLink) {
      return {
        getAttribute(name) {
          return name === 'href' ? '/bob' : null;
        }
      };
    }
    return null;
  };

  button.click();
  await flushAsyncWork();

  const destroyRequests = requestedUrls.filter((entry) => entry.url.endsWith('/i/api/1.1/blocks/destroy.json'));
  assert.equal(destroyRequests.length, 0, 'no destroy request should fire for the stale restId');
  assert.equal(button.dataset.state, 'idle');
  assert.equal(button.dataset.userCellBlockMode, 'block');
  assert.equal(button.dataset.userRestId, undefined);
  assert.equal(followButton.hidden, false);
});

test('createUserCellBlockButton retries a failed unblock without restoring follow state early', async (t) => {
  const { documentRef } = createDocumentStub();
  const { followButton, userCell } = createUserCellNode('Felixmfdo');
  const requestedUrls = [];
  const originalError = console.error;
  let unblockAttempts = 0;

  useGlobalOverrides(t, { document: documentRef });
  setCurrentNativeButtonStyle(PAGE_BLOCK_BUTTON_STYLES.text);
  console.error = () => {};
  t.after(() => {
    setCurrentNativeButtonStyle(PAGE_BLOCK_BUTTON_STYLES.icon);
    console.error = originalError;
  });

  const button = createUserCellBlockButton(userCell, {
    actionButton: followButton,
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    async fetchImpl(url, options = {}) {
      requestedUrls.push({ options, url });

      if (url.endsWith('/i/api/1.1/blocks/destroy.json')) {
        unblockAttempts += 1;

        if (unblockAttempts === 1) {
          return {
            ok: false,
            status: 500,
            async text() {
              return 'temporary unblock failure';
            }
          };
        }

        return {
          ok: true,
          async json() {
            return { ok: true };
          }
        };
      }

      if (options.method === 'POST') {
        return {
          ok: true,
          async json() {
            return { ok: true };
          }
        };
      }

      return {
        ok: true,
        async json() {
          return {
            data: {
              user: {
                result: {
                  rest_id: '111'
                }
              }
            }
          };
        }
      };
    },
    cache: new Map(),
    queryIds: ['workingQueryId']
  });

  button.click();
  await flushAsyncWork();

  assert.equal(button.dataset.state, 'blocked');
  assert.equal(button.dataset.userCellBlockMode, 'unblock');
  assert.equal(button.dataset.userRestId, '111');
  assert.equal(followButton.hidden, true);
  assert.equal(followButton.style.display, 'none');

  button.dispatch('mouseenter');
  assert.equal(button.dataset.state, 'unblock');

  button.click();
  await flushAsyncWork();

  assert.equal(button.dataset.state, 'error');
  assert.equal(button.dataset.userCellBlockMode, 'unblock');
  assert.equal(button.dataset.userRestId, '111');
  assert.equal(button.textContent, 'Retry unblock');
  assert.equal(button.title, 'Retry unblock for @Felixmfdo from this list');
  assert.equal(followButton.hidden, true);
  assert.equal(followButton.style.display, 'none');

  button.click();
  await flushAsyncWork();

  assert.equal(button.dataset.state, 'idle');
  assert.equal(button.dataset.userCellBlockMode, 'block');
  assert.equal(button.dataset.userRestId, undefined);
  assert.equal(button.textContent, 'Block');
  assert.equal(followButton.hidden, false);
  assert.equal(followButton.style.display, '');
  assert.equal(unblockAttempts, 2);
  assert.equal(requestedUrls.length, 4);
  assert.equal(requestedUrls[2].url.endsWith('/i/api/1.1/blocks/destroy.json'), true);
  assert.equal(requestedUrls[3].url.endsWith('/i/api/1.1/blocks/destroy.json'), true);
});

test('createNativeBlockButton runs the native flow and updates state on success', async (t) => {
  const { documentRef } = createDocumentStub();
  const clickOrder = [];
  const blockMenuItem = {
    click() {
      clickOrder.push('menu');
    }
  };
  const confirmButton = {
    click() {
      clickOrder.push('confirm');
    }
  };

  useGlobalOverrides(t, { document: documentRef });

  const button = createNativeBlockButton({
    querySelector(selector) {
      if (selector === SELECTORS.caretButton) {
        return {
          click() {
            clickOrder.push('caret');
          }
        };
      }

      if (selector === SELECTORS.permalink) {
        return {
          getAttribute(name) {
            return name === 'href' ? '/Felixmfdo/status/1' : null;
          }
        };
      }

      return null;
    }
  }, {
    querySelector(selector) {
      if (selector === SELECTORS.blockMenuItem) {
        return blockMenuItem;
      }

      if (selector === SELECTORS.blockConfirmButton) {
        return confirmButton;
      }

      return null;
    }
  });

  button.click();
  await flushAsyncWork();

  assert.deepEqual(clickOrder, ['caret', 'menu', 'confirm']);
  assert.equal(button.dataset.state, 'success');
});

test('createProfileBlockButton runs the profile native flow and updates state on success', async (t) => {
  const { documentRef } = createProfilePageDocument('281v6s1b5z51');
  const clickOrder = [];
  const blockMenuItem = {
    click() {
      clickOrder.push('menu');
    }
  };
  const confirmButton = {
    click() {
      clickOrder.push('confirm');
    }
  };

  documentRef.querySelector = (selector) => {
    if (selector === SELECTORS.profileActionsButton) {
      return {
        click() {
          clickOrder.push('profile-actions');
        }
      };
    }

    if (selector === SELECTORS.blockMenuItem) {
      return blockMenuItem;
    }

    if (selector === SELECTORS.blockConfirmButton) {
      return confirmButton;
    }

    return null;
  };

  useGlobalOverrides(t, { document: documentRef });

  const button = createProfileBlockButton(documentRef);

  button.click();
  await flushAsyncWork();

  assert.deepEqual(clickOrder, ['profile-actions', 'menu', 'confirm']);
  assert.equal(button.dataset.state, 'success');
  assert.equal(button.hidden, true);
  assert.equal(button.style.display, 'none');
});

test('runProfileNativeBlockFlow requires the profile actions button', async () => {
  await assert.rejects(async () => runProfileNativeBlockFlow({
    querySelector() {
      return null;
    }
  }), /Missing profile actions button/);
});

test('registerRuntimeMessageListener attaches only once and answers block requests', async () => {
  const listeners = [];
  const responses = [];
  const globalRef = {
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            listeners.push(listener);
          }
        }
      }
    },
    document: {}
  };

  registerRuntimeMessageListener(globalRef);
  registerRuntimeMessageListener(globalRef);

  assert.equal(listeners.length, 1);
  assert.equal(globalRef.__easyTweetBlockRuntimeListenerAttached__, true);
  assert.equal(listeners[0]({ type: 'other' }, null, () => {}), false);
  assert.equal(listeners[0]({
    delayMs: 1200,
    type: MESSAGE_TYPES.blockUsernamesViaApi,
    usernames: ['bad-name']
  }, null, (response) => {
    responses.push(response);
  }), true);

  await flushAsyncWork();

  assert.deepEqual(responses, [{ ok: true, results: [] }]);
});

test('registerRuntimeMessageListener answers followers preview and follower block requests', async (t) => {
  const listeners = [];
  const progressMessages = [];
  const responses = [];
  const globalRef = {
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            listeners.push(listener);
          }
        },
        sendMessage(message) {
          progressMessages.push(message);
        }
      }
    },
    document: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: {
        origin: 'https://x.com',
        pathname: '/targetuser/followers'
      }
    }
  };

  registerRuntimeMessageListener(globalRef);

  const originalScanFollowersForBlocking = globalThis.EasyTweetBlockContent.scanFollowersForBlocking;
  const originalBlockFollowerCandidatesViaApi = globalThis.EasyTweetBlockContent.blockFollowerCandidatesViaApi;

  globalThis.EasyTweetBlockContent.scanFollowersForBlocking = async (_options, runtimeOptions) => {
    assert.equal(Boolean(runtimeOptions.signal), true);

    return {
      alreadyBlockedCount: 1,
      candidates: [{ restId: '101', username: 'alice' }],
      hasMorePages: false,
      readyCount: 1,
      scannedCount: 3,
      targetRestId: '999',
      targetScreenName: 'targetuser'
    };
  };
  globalThis.EasyTweetBlockContent.blockFollowerCandidatesViaApi = async (_candidates, options) => {
    assert.equal(Boolean(options.signal), true);
    options.onProgress({
      completed: 1,
      delayMs: options.delayMs,
      failureCount: 0,
      phase: 'finished',
      successCount: 1,
      total: 1
    });

    return [{ ok: true, restId: '101', username: 'alice' }];
  };

  t.after(() => {
    globalThis.EasyTweetBlockContent.scanFollowersForBlocking = originalScanFollowersForBlocking;
    globalThis.EasyTweetBlockContent.blockFollowerCandidatesViaApi = originalBlockFollowerCandidatesViaApi;
  });

  assert.equal(listeners[0]({
    options: { blockLimit: 1, scanLimit: 3 },
    runId: 'scan-run-1',
    type: MESSAGE_TYPES.scanFollowersForBlock
  }, null, (response) => {
    responses.push(response);
  }), true);

  assert.equal(listeners[0]({
    candidates: [{ restId: '101', username: 'alice' }],
    delayMs: 1200,
    runId: 'run-1',
    type: MESSAGE_TYPES.blockFollowerCandidatesViaApi
  }, null, (response) => {
    responses.push(response);
  }), true);

  await flushAsyncWork();

  assert.deepEqual(responses, [
    {
      ok: true,
      preview: {
        alreadyBlockedCount: 1,
        candidates: [{ restId: '101', username: 'alice' }],
        hasMorePages: false,
        readyCount: 1,
        scannedCount: 3,
        targetRestId: '999',
        targetScreenName: 'targetuser'
      }
    },
    {
      ok: true,
      results: [{ ok: true, restId: '101', username: 'alice' }]
    }
  ]);
  assert.deepEqual(progressMessages, [{
    progress: {
      completed: 1,
      delayMs: 1200,
      failureCount: 0,
      phase: 'finished',
      successCount: 1,
      total: 1
    },
    runId: 'run-1',
    type: MESSAGE_TYPES.followerBlockProgress
  }]);
});

test('registerRuntimeConnectionListener cancels an active follower run when the popup port disconnects', () => {
  const connectListeners = [];
  const disconnectListeners = [];
  const globalRef = {
    chrome: {
      runtime: {
        onConnect: {
          addListener(listener) {
            connectListeners.push(listener);
          }
        }
      }
    }
  };

  registerRuntimeConnectionListener(globalRef);
  registerRuntimeConnectionListener(globalRef);

  assert.equal(connectListeners.length, 1);

  const followerRun = startFollowerRun('port-run-1');

  connectListeners[0]({
    name: `${FOLLOWER_RUN_PORT_PREFIX}port-run-1`,
    onDisconnect: {
      addListener(listener) {
        disconnectListeners.push(listener);
      }
    }
  });

  assert.equal(disconnectListeners.length, 1);
  assert.equal(followerRun.signal.aborted, false);
  disconnectListeners[0]();
  assert.equal(followerRun.signal.aborted, true);
  finishFollowerRun('port-run-1', followerRun.controller);
});

test('cancelFollowerRun does not poison an already finished run id', () => {
  const firstRun = startFollowerRun('finished-run-1');

  finishFollowerRun('finished-run-1', firstRun.controller);
  assert.equal(cancelFollowerRun('finished-run-1'), false);

  const secondRun = startFollowerRun('finished-run-1');

  assert.equal(secondRun.signal.aborted, false);
  finishFollowerRun('finished-run-1', secondRun.controller);
});

test('registerRuntimeMessageListener falls back to free chrome/browser globals when globalRef hides them', async (t) => {
  const listeners = [];
  const responses = [];
  const fakeChrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          listeners.push(listener);
        }
      }
    }
  };

  useGlobalOverrides(t, { chrome: fakeChrome });

  const globalRef = {
    document: {}
  };

  registerRuntimeMessageListener(globalRef);

  assert.equal(listeners.length, 1);
  assert.equal(globalRef.__easyTweetBlockRuntimeListenerAttached__, true);
  assert.equal(listeners[0]({
    delayMs: 500,
    type: MESSAGE_TYPES.blockUsernamesViaApi,
    usernames: ['bad-name']
  }, null, (response) => {
    responses.push(response);
  }), true);

  await flushAsyncWork();

  assert.deepEqual(responses, [{ ok: true, results: [] }]);
});

test('init installs styles, registers runtime messaging, and observes added tweets once', (t) => {
  const { documentRef } = createDocumentStub();
  const { caretButton, leadingAction, localButtonGroup, parentElement, tweetNode } = createTweetNode();
  let observedConfig = null;
  let observerCallback = null;
  const runtimeListeners = [];
  const storageListeners = [];

  useGlobalOverrides(t, { document: documentRef });

  class FakeMutationObserver {
    constructor(callback) {
      observerCallback = callback;
    }

    observe(target, options) {
      observedConfig = { options, target };
    }
  }

  const globalRef = {
    MutationObserver: FakeMutationObserver,
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            runtimeListeners.push(listener);
          }
        }
      },
      storage: {
        local: {
          get(_keys, callback) {
            callback({
              [PAGE_BLOCK_BUTTON_STYLES_STORAGE_KEY]: {
                [PAGE_BUTTON_STYLE_SURFACES.tweet]: PAGE_BLOCK_BUTTON_STYLES.text,
                [PAGE_BUTTON_STYLE_SURFACES.profile]: PAGE_BLOCK_BUTTON_STYLES.text,
                [PAGE_BUTTON_STYLE_SURFACES.userCell]: PAGE_BLOCK_BUTTON_STYLES.text
              }
            });
          }
        },
        onChanged: {
          addListener(listener) {
            storageListeners.push(listener);
          },
          removeListener() {}
        }
      }
    },
    document: documentRef
  };

  init(globalRef);
  return flushAsyncWork().then(() => {
    assert.equal(globalRef.__easyTweetBlockInjected__, true);
    assert.equal(documentRef.head.appendedNodes.length, 0);
    assert.deepEqual(observedConfig, {
      options: {
        childList: true,
        subtree: true
      },
      target: documentRef.body
    });
    assert.equal(runtimeListeners.length, 1);
    assert.equal(storageListeners.length, 4);

    observerCallback([{ addedNodes: [tweetNode] }]);

    assert.equal(parentElement.children[0], leadingAction);
    assert.equal(leadingAction.children[0].dataset.kind, BUTTON_KINDS.native);
    assert.equal(leadingAction.children[0].dataset.displayStyle, PAGE_BLOCK_BUTTON_STYLES.text);
    assert.equal(leadingAction.children[0].textContent, 'Block');
    assert.equal(parentElement.children[1].querySelector('button'), caretButton);
    assert.equal(localButtonGroup.children[0], caretButton);

    init(globalRef);

    assert.equal(documentRef.head.appendedNodes.length, 0);
    assert.equal(runtimeListeners.length, 1);
  });
});

test('init repositions the native button when the Grok action appears after the caret', (t) => {
  const { documentRef } = createDocumentStub();
  const { caretButton, leadingAction, localButtonGroup, parentElement, tweetNode } = createTweetNode('Felixmfdo', {
    includeLeadingAction: false
  });
  let observerCallback = null;

  useGlobalOverrides(t, { document: documentRef });

  class FakeMutationObserver {
    constructor(callback) {
      observerCallback = callback;
    }

    observe() {}
  }

  const globalRef = {
    MutationObserver: FakeMutationObserver,
    chrome: {
      runtime: {
        onMessage: {
          addListener() {}
        }
      },
      storage: {
        local: {
          get(_keys, callback) {
            callback({});
          }
        },
        onChanged: {
          addListener() {},
          removeListener() {}
        }
      }
    },
    document: documentRef
  };

  init(globalRef);
  observerCallback([{ addedNodes: [tweetNode] }]);

  const nativeButton = localButtonGroup.children[0];

  assert.equal(nativeButton.dataset.kind, BUTTON_KINDS.native);
  assert.equal(localButtonGroup.children[1], caretButton);

  parentElement.insertBefore(leadingAction, parentElement.firstElementChild);
  observerCallback([{ addedNodes: [leadingAction] }]);

  assert.equal(leadingAction.children[0], nativeButton);
  assert.equal(localButtonGroup.children[0], caretButton);
});

test('init adds the native block button to the profile action bar on initial page scan', (t) => {
  const { actionBar, documentRef, moreButton } = createProfilePageDocument('281v6s1b5z51');
  let observerCallback = null;

  useGlobalOverrides(t, { document: documentRef });

  class FakeMutationObserver {
    constructor(callback) {
      observerCallback = callback;
    }

    observe() {}
  }

  const globalRef = {
    MutationObserver: FakeMutationObserver,
    chrome: {
      runtime: {
        onMessage: {
          addListener() {}
        }
      },
      storage: {
        local: {
          get(_keys, callback) {
            callback({});
          }
        },
        onChanged: {
          addListener() {},
          removeListener() {}
        }
      }
    },
    document: documentRef
  };

  init(globalRef);
  return flushAsyncWork().then(() => {
    assert.equal(actionBar.children[0].dataset.kind, BUTTON_KINDS.native);
    assert.equal(actionBar.children[1], moreButton);
    assert.equal(typeof observerCallback, 'function');
  });
});

test('extractGraphqlQueryIdsFromScriptText reads query ids near an operation name', () => {
  const scriptText = 'const op={queryId:"dynamicFollowersQueryId",operationName:"Followers"};'
    + 'const other={queryId:"dynamicUserQueryId",operationName:"UserByScreenName"};';

  assert.deepEqual(extractGraphqlQueryIdsFromScriptText(scriptText, 'Followers'), ['dynamicFollowersQueryId']);
});

test('fetchFollowersPage tries known followers query ids before dynamic discovery', async () => {
  const requestedUrls = [];
  const documentRef = {
    baseURI: 'https://x.com/Alice',
    cookie: 'ct0=token123',
    documentElement: { lang: 'en-US' },
    location: { origin: 'https://x.com' },
    querySelectorAll() {
      throw new Error('discovery should not run when a known followers query id works');
    }
  };

  async function fetchImpl(url, options) {
    requestedUrls.push(url);
    assert.equal(options.headers['content-type'], 'application/json');

    return {
      ok: true,
      async json() {
        return {
          data: {
            user: {
              result: {
                timeline: {
                  timeline: {
                    instructions: []
                  }
                }
              }
            }
          }
        };
      }
    };
  }

  await fetchFollowersPage('2743192327', {
    documentRef,
    fetchImpl,
    queryIds: ['staticFollowersQueryId']
  });

  assert.equal(requestedUrls.length, 1);
  assert.equal(requestedUrls[0].includes('/staticFollowersQueryId/Followers'), true);
});

test('fetchFollowersPage discovers followers query ids after known ids fail', async () => {
  const requestedUrls = [];
  const documentRef = {
    baseURI: 'https://x.com/Alice',
    cookie: 'ct0=token123',
    documentElement: { lang: 'en-US' },
    location: { origin: 'https://x.com' },
    querySelectorAll(selector) {
      assert.equal(selector, 'script[src], link[href]');
      return [{ src: 'https://abs.twimg.com/responsive-web/client-web/main.js' }];
    }
  };

  async function fetchImpl(url) {
    requestedUrls.push(url);

    if (url.includes('/staticFollowersQueryId/Followers')) {
      return {
        ok: false,
        status: 404
      };
    }

    if (url === 'https://abs.twimg.com/responsive-web/client-web/main.js') {
      return {
        ok: true,
        async text() {
          return 'const op={queryId:"dynamicFollowersQueryId",operationName:"Followers"};';
        }
      };
    }

    return {
      ok: true,
      async json() {
        return {
          data: {
            user: {
              result: {
                timeline: {
                  timeline: {
                    instructions: []
                  }
                }
              }
            }
          }
        };
      }
    };
  }

  await fetchFollowersPage('2743192327', {
    documentRef,
    fetchImpl,
    queryIds: ['staticFollowersQueryId']
  });

  assert.equal(requestedUrls[0].includes('/staticFollowersQueryId/Followers'), true);
  assert.equal(requestedUrls[1], 'https://abs.twimg.com/responsive-web/client-web/main.js');
  assert.equal(requestedUrls[2].includes('/dynamicFollowersQueryId/Followers'), true);
});

test('discoverGraphqlQueryIds returns matching ids from X script assets', async () => {
  const documentRef = {
    baseURI: 'https://x.com/Alice',
    location: { origin: 'https://x.com' },
    querySelectorAll() {
      return [{ src: 'https://abs.twimg.com/responsive-web/client-web/profile.js' }];
    }
  };

  async function fetchImpl() {
    return {
      ok: true,
      async text() {
        return 'const op={operationName:"FollowersAssetTest",queryId:"assetFollowersQueryId"};';
      }
    };
  }

  const queryIds = await discoverGraphqlQueryIds('FollowersAssetTest', {
    documentRef,
    fetchImpl
  });

  assert.deepEqual(queryIds, ['assetFollowersQueryId']);
});

test('x client transaction helpers extract runtime material', () => {
  const runtimeSource = '123:"ondemand.s";abc})[e]||e)+"."+({123:"hash_ABC-"})';
  const indicesSource = 'alpha(w[7], 16);beta(w[2],16);gamma(w[11], 16);';
  const documentRef = {
    querySelector(selector) {
      assert.equal(selector, "[name='twitter-site-verification']");
      return {
        getAttribute(name) {
          assert.equal(name, 'content');
          return 'site-key';
        }
      };
    }
  };

  assert.equal(
    resolveOnDemandFileUrlFromRuntime(runtimeSource),
    'https://abs.twimg.com/responsive-web/client-web/ondemand.s.hash_ABC-a.js'
  );
  assert.deepEqual(extractXClientTransactionIndicesFromScriptText(indicesSource), {
    keyByteIndices: [2, 11],
    rowIndex: 7
  });
  assert.equal(extractXClientTransactionKeyFromDocument(documentRef), 'site-key');
});

test('fetchFollowersPage includes generated x-client-transaction-id when available', async (t) => {
  const requestedHeaders = [];
  const originalGenerator = globalThis.EasyTweetBlockContent.tryGenerateXClientTransactionId;

  t.after(() => {
    globalThis.EasyTweetBlockContent.tryGenerateXClientTransactionId = originalGenerator;
  });

  globalThis.EasyTweetBlockContent.tryGenerateXClientTransactionId = async (method, path) => {
    assert.equal(method, 'GET');
    assert.equal(path, '/i/api/graphql/workingFollowersQueryId/Followers');
    return 'generated-transaction-id';
  };

  async function fetchImpl(_url, options = {}) {
    requestedHeaders.push(options.headers || {});

    return {
      ok: true,
      async json() {
        return {
          data: {
            user: {
              result: {
                timeline: {
                  timeline: {
                    instructions: []
                  }
                }
              }
            }
          }
        };
      }
    };
  }

  await fetchFollowersPage('2743192327', {
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    fetchImpl,
    queryIds: ['workingFollowersQueryId']
  });

  assert.equal(requestedHeaders[0]['x-client-transaction-id'], 'generated-transaction-id');
});

test('tryGenerateXClientTransactionId caches transaction state from completion time', async (t) => {
  const originalDateNow = Date.now;
  const originalCache = globalThis.EasyTweetBlockContent.contentState.xClientTransactionCache;
  let currentTime = 0;
  let fetchCount = 0;

  Date.now = () => currentTime;
  globalThis.EasyTweetBlockContent.contentState.xClientTransactionCache = new Map();

  t.after(() => {
    Date.now = originalDateNow;
    globalThis.EasyTweetBlockContent.contentState.xClientTransactionCache = originalCache;
  });

  const documentRef = {
    documentElement: {
      outerHTML: '123:"ondemand.s";abc})[e]||e)+"."+({123:"hash_ABC-"})'
    },
    querySelector(selector) {
      assert.equal(selector, "[name='twitter-site-verification']");
      return {
        getAttribute(name) {
          assert.equal(name, 'content');
          return 'AAAAAAAA';
        }
      };
    },
    querySelectorAll(selector) {
      if (selector === 'script') {
        return [];
      }

      if (selector === "[id^='loading-x-anim']") {
        return [{
          children: [{
            children: [null, {
              getAttribute(name) {
                assert.equal(name, 'd');
                return '0000000001 2 3 4 5 6 7 8 9 10 11 12 13';
              }
            }]
          }]
        }];
      }

      return [];
    }
  };

  async function fetchImpl(url) {
    fetchCount += 1;
    assert.equal(url, 'https://abs.twimg.com/responsive-web/client-web/ondemand.s.hash_ABC-a.js');
    currentTime = 300000;

    return {
      ok: true,
      async text() {
        return 'alpha(w[0], 16);beta(w[1],16);gamma(w[2], 16);';
      }
    };
  }

  const firstId = await tryGenerateXClientTransactionId('GET', '/i/api/graphql/test/Followers', {
    baseOrigin: 'https://x.com',
    documentRef,
    fetchImpl,
    randomByte: 0,
    timeNow: 1
  });

  currentTime = 600001;

  const secondId = await tryGenerateXClientTransactionId('GET', '/i/api/graphql/test/Followers', {
    baseOrigin: 'https://x.com',
    documentRef,
    fetchImpl,
    randomByte: 0,
    timeNow: 1
  });

  assert.equal(typeof firstId, 'string');
  assert.equal(firstId.length > 0, true);
  assert.equal(secondId, firstId);
  assert.equal(fetchCount, 1);
});

test('scanFollowersForBlocking stops scanning and limits request count when it hits consecutive empty pages limit', async () => {
  const requestedTimelineUrls = [];
  let timelineRequestCount = 0;

  async function fetchImpl(url) {
    if (url.includes('/UserByScreenName')) {
      return {
        ok: true,
        async json() {
          return {
            data: {
              user: {
                result: {
                  rest_id: '999'
                }
              }
            }
          };
        }
      };
    }

    requestedTimelineUrls.push(url);
    timelineRequestCount += 1;

    // Return empty pages with cursor indefinitely
    return {
      ok: true,
      async json() {
        return {
          data: {
            user: {
              result: {
                timeline: {
                  timeline: {
                    instructions: [{
                      entries: [{
                        content: {
                          cursorType: 'Bottom',
                          value: `cursor-bottom-${timelineRequestCount}`
                        }
                      }]
                    }]
                  }
                }
              }
            }
          }
        };
      }
    };
  }

  const preview = await scanFollowersForBlocking({
    blockLimit: 10,
    scanLimit: 5
  }, {
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: {
        origin: 'https://x.com',
        pathname: '/targetuser/followers'
      }
    },
    fetchImpl,
    queryIds: ['followersWorkingQueryId'],
    userLookupQueryIds: ['workingUserLookup']
  });

  // Should stop after 2 empty pages, despite scanLimit being 5 and hasMorePages being true
  assert.equal(preview.readyCount, 0);
  assert.equal(preview.scannedCount, 0);
  assert.equal(preview.hasMorePages, true);
  assert.equal(requestedTimelineUrls.length, 2);
});
