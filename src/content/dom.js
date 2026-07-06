(() => {
  if (typeof module !== 'undefined' && module.exports) {
    require('./shared.js');
  }

  const namespace = globalThis.EasyTweetBlockContent || (globalThis.EasyTweetBlockContent = {});
  const {
    BLOCK_BUTTON_ATTRIBUTE,
    BUTTON_ACTION_ATTRIBUTE,
    BUTTON_ACTIONS,
    SELECTORS
  } = namespace;
  const USER_CELL_ACTIONS_ATTRIBUTE = 'data-easy-tweetblock-user-cell-actions';

  function getElementChildren(node) {
    if (!node) {
      return [];
    }

    if (Array.isArray(node.children)) {
      return node.children.filter(Boolean);
    }

    if (node.children) {
      return Array.from(node.children);
    }

    return [];
  }

  function subtreeContainsButton(node) {
    if (!node) {
      return false;
    }

    if (node.tagName === 'button' || node.tagName === 'BUTTON') {
      return true;
    }

    if (typeof node.matches === 'function' && node.matches('button')) {
      return true;
    }

    if (typeof node.querySelector === 'function' && node.querySelector('button')) {
      return true;
    }

    return getElementChildren(node).some((child) => subtreeContainsButton(child));
  }

  function nodeMatchesOrContains(node, selector) {
    if (!node || (node.nodeType !== 1 && node.nodeType !== 9)) {
      return false;
    }

    if (typeof node.matches === 'function' && node.matches(selector)) {
      return true;
    }

    return typeof node.querySelector === 'function' && Boolean(node.querySelector(selector));
  }

  function findManagedButton(rootNode) {
    if (!rootNode) {
      return null;
    }

    if (
      typeof rootNode.getAttribute === 'function'
      && rootNode.getAttribute(BLOCK_BUTTON_ATTRIBUTE) !== null
    ) {
      return rootNode;
    }

    for (const child of getElementChildren(rootNode)) {
      const match = findManagedButton(child);

      if (match) {
        return match;
      }
    }

    return null;
  }

  function readManagedButtonAction(button) {
    const action = button?.getAttribute?.(BUTTON_ACTION_ATTRIBUTE)
      || button?.dataset?.easyTweetblockAction
      || button?.dataset?.action;

    if (action === BUTTON_ACTIONS?.saveToList) {
      return BUTTON_ACTIONS.saveToList;
    }

    return button?.getAttribute?.(BLOCK_BUTTON_ATTRIBUTE) !== null ? BUTTON_ACTIONS?.block : null;
  }

  function findManagedButtonByAction(rootNode, action) {
    if (!rootNode || !action) {
      return null;
    }

    if (
      typeof rootNode.getAttribute === 'function'
      && rootNode.getAttribute(BLOCK_BUTTON_ATTRIBUTE) !== null
      && readManagedButtonAction(rootNode) === action
    ) {
      return rootNode;
    }

    for (const child of getElementChildren(rootNode)) {
      const match = findManagedButtonByAction(child, action);

      if (match) {
        return match;
      }
    }

    return null;
  }

  function findActionRowContainer(caretButton, tweet) {
    let current = caretButton?.parentElement || null;

    while (current && current !== tweet) {
      const childElements = getElementChildren(current);

      if (
        childElements.length > 1
        && childElements.every((child) => subtreeContainsButton(child))
        && childElements.every((child) => child.tagName !== 'button' && child.tagName !== 'BUTTON')
      ) {
        return current;
      }

      current = current.parentElement || null;
    }

    return caretButton?.parentElement || null;
  }

  function findPrimaryActionWrapper(caretButton, tweet) {
    const actionRowContainer = findActionRowContainer(caretButton, tweet);
    const actionRowChildren = getElementChildren(actionRowContainer);

    if (actionRowChildren.length > 1) {
      return actionRowChildren.find((child) => nodeMatchesOrContains(child, SELECTORS.grokButton))
        || actionRowChildren[0];
    }

    return actionRowContainer;
  }

  function findAncestorTweet(node) {
    let current = node?.nodeType === 1 ? node : node?.parentElement || null;

    while (current) {
      if (typeof current.matches === 'function' && current.matches(SELECTORS.tweet)) {
        return current;
      }

      current = current.parentElement || null;
    }

    return null;
  }

  function findAncestorUserCell(node) {
    let current = node?.nodeType === 1 ? node : node?.parentElement || null;

    while (current) {
      if (typeof current.matches === 'function' && current.matches(SELECTORS.userCell)) {
        return current;
      }

      current = current.parentElement || null;
    }

    return null;
  }

  function findFirstDescendant(rootNode, predicate) {
    for (const child of getElementChildren(rootNode)) {
      if (predicate(child)) {
        return child;
      }

      const nestedMatch = findFirstDescendant(child, predicate);

      if (nestedMatch) {
        return nestedMatch;
      }
    }

    return null;
  }

  function isButtonElement(node) {
    if (!node) {
      return false;
    }

    if (node.tagName === 'button' || node.tagName === 'BUTTON') {
      return true;
    }

    return typeof node.matches === 'function' && node.matches('button');
  }

  function findDirectChildAncestor(ancestorNode, descendantNode) {
    let current = descendantNode || null;

    while (current?.parentElement && current.parentElement !== ancestorNode) {
      current = current.parentElement;
    }

    return current?.parentElement === ancestorNode ? current : null;
  }

  function findUserCellActionButton(userCell) {
    return findFirstDescendant(userCell, (node) => (
      isButtonElement(node)
      && node.getAttribute?.(BLOCK_BUTTON_ATTRIBUTE) === null
    ));
  }

  function findUserCellActionBar(actionButton, userCell) {
    let current = actionButton?.parentElement || null;

    while (current && current !== userCell) {
      if (findDirectChildAncestor(current, actionButton) && getElementChildren(current).length > 1) {
        return current;
      }

      current = current.parentElement || null;
    }

    return actionButton?.parentElement || null;
  }

  function readUserCellActionButtonText(actionButton) {
    if (!actionButton) {
      return '';
    }

    const rawText = [
      actionButton.textContent,
      actionButton.innerText,
      actionButton.getAttribute?.('aria-label'),
      actionButton.title
    ].find((value) => typeof value === 'string' && value.trim());

    return typeof rawText === 'string'
      ? rawText.trim().replace(/\s+/g, ' ').toLowerCase()
      : '';
  }

  function syncUserCellBlockButtonVisibility(button, actionButton) {
    if (!button || readManagedButtonAction(button) !== BUTTON_ACTIONS.block) {
      return;
    }

    const normalizedText = readUserCellActionButtonText(actionButton);
    const isBlocked = normalizedText.includes('blocked') || normalizedText.includes('unblock');
    button.hidden = isBlocked;

    if (typeof button.setAttribute === 'function') {
      button.setAttribute('aria-hidden', String(isBlocked));
    }
  }

  function attachButtonToTweet(tweet, documentRef = document) {
    if (!tweet) {
      return;
    }

    const existingButton = tweet.querySelector(`[${BLOCK_BUTTON_ATTRIBUTE}]`);
    const caretButton = tweet.querySelector(SELECTORS.caretButton);

    if (!caretButton?.parentElement) {
      return;
    }

    const nativeButton = existingButton || namespace.createNativeBlockButton?.(tweet, documentRef);

    if (!nativeButton) {
      return;
    }

    const actionWrapper = findPrimaryActionWrapper(caretButton, tweet);

    if (!actionWrapper || typeof actionWrapper.insertBefore !== 'function') {
      return;
    }

    const actionWrapperChildren = getElementChildren(actionWrapper);
    const firstActionWrapperChild = actionWrapper.firstElementChild
      || actionWrapperChildren[0]
      || null;

    if (nativeButton.parentElement === actionWrapper && firstActionWrapperChild === nativeButton) {
      return;
    }

    const referenceNode = actionWrapperChildren.find((child) => child !== nativeButton) || null;

    actionWrapper.insertBefore(nativeButton, referenceNode);
  }

  function findProfileActionBar(profileActionsButton) {
    const actionBar = profileActionsButton?.parentElement || null;

    if (!actionBar || typeof actionBar.insertBefore !== 'function') {
      return null;
    }

    return actionBar;
  }

  function attachButtonToProfilePage(documentRef = document) {
    if (!documentRef || typeof documentRef.querySelector !== 'function') {
      return;
    }

    const profileActionsButton = documentRef.querySelector(SELECTORS.profileActionsButton);

    if (!profileActionsButton) {
      return;
    }

    const actionBar = findProfileActionBar(profileActionsButton);

    if (!actionBar) {
      return;
    }

    const existingButton = findManagedButton(actionBar);
    const nativeButton = existingButton || namespace.createProfileBlockButton?.(documentRef);

    if (!nativeButton) {
      return;
    }

    const actionBarChildren = getElementChildren(actionBar);
    const profileActionsButtonIndex = actionBarChildren.indexOf(profileActionsButton);

    if (
      nativeButton.parentElement === actionBar
      && profileActionsButtonIndex > 0
      && actionBarChildren[profileActionsButtonIndex - 1] === nativeButton
    ) {
      return;
    }

    actionBar.insertBefore(nativeButton, profileActionsButton);
  }

  function attachButtonToUserCell(userCell, documentRef = document) {
    if (!userCell) {
      return;
    }

    const actionButton = findUserCellActionButton(userCell);

    if (!actionButton) {
      return;
    }

    const actionBar = findUserCellActionBar(actionButton, userCell);

    if (!actionBar || typeof actionBar.insertBefore !== 'function') {
      return;
    }

    const existingBlockButton = findManagedButtonByAction(userCell, BUTTON_ACTIONS.block);
    const existingListButton = findManagedButtonByAction(userCell, BUTTON_ACTIONS.saveToList);
    const listButton = existingListButton || namespace.createUserCellListButton?.(userCell, {
      documentRef
    });
    const nativeButton = existingBlockButton || namespace.createUserCellBlockButton?.(userCell, {
      documentRef
    });

    if (!nativeButton && !listButton) {
      return;
    }

    const actionWrapper = findDirectChildAncestor(actionBar, actionButton) || actionButton.parentElement || null;

    if (!actionWrapper || typeof actionWrapper.insertBefore !== 'function') {
      return;
    }

    if (typeof actionWrapper.setAttribute === 'function') {
      actionWrapper.setAttribute(USER_CELL_ACTIONS_ATTRIBUTE, 'true');
    }

    const actionWrapperChildren = getElementChildren(actionWrapper);
    const listButtonIndex = actionWrapperChildren.indexOf(listButton);
    const nativeButtonIndex = actionWrapperChildren.indexOf(nativeButton);
    const actionButtonIndex = actionWrapperChildren.indexOf(actionButton);

    if (nativeButton) {
      syncUserCellBlockButtonVisibility(nativeButton, actionButton);
    }

    if (
      (!listButton || listButton.parentElement === actionWrapper)
      && (!nativeButton || nativeButton.parentElement === actionWrapper)
      && (!listButton || listButtonIndex !== -1)
      && (!nativeButton || nativeButtonIndex !== -1)
      && (!listButton || !nativeButton || nativeButtonIndex === listButtonIndex + 1)
      && actionButtonIndex === (nativeButton ? nativeButtonIndex + 1 : listButtonIndex + 1)
    ) {
      return;
    }

    if (nativeButton) {
      actionWrapper.insertBefore(nativeButton, actionButton);
    }

    if (listButton) {
      actionWrapper.insertBefore(listButton, nativeButton || actionButton);
    }

    if (nativeButton) {
      syncUserCellBlockButtonVisibility(nativeButton, actionButton);
    }
  }

  function collectTweets(rootNode) {
    if (!rootNode || typeof rootNode.querySelectorAll !== 'function') {
      return [];
    }

    const tweets = [];

    if (typeof rootNode.matches === 'function' && rootNode.matches(SELECTORS.tweet)) {
      tweets.push(rootNode);
    }

    return tweets.concat(Array.from(rootNode.querySelectorAll(SELECTORS.tweet)));
  }

  function collectUserCells(rootNode) {
    if (!rootNode || typeof rootNode.querySelectorAll !== 'function') {
      return [];
    }

    const userCells = [];

    if (typeof rootNode.matches === 'function' && rootNode.matches(SELECTORS.userCell)) {
      userCells.push(rootNode);
    }

    return userCells.concat(Array.from(rootNode.querySelectorAll(SELECTORS.userCell)));
  }

  function processNode(rootNode, documentRef = document) {
    const tweets = collectTweets(rootNode);
    const userCells = collectUserCells(rootNode);
    const isOwnButton = rootNode?.nodeType === 1
      && typeof rootNode.matches === 'function'
      && rootNode.matches(`[${BLOCK_BUTTON_ATTRIBUTE}]`);

    if (
      !isOwnButton
      && (nodeMatchesOrContains(rootNode, SELECTORS.grokButton) || nodeMatchesOrContains(rootNode, SELECTORS.caretButton))
    ) {
      const ancestorTweet = findAncestorTweet(rootNode);

      if (ancestorTweet && !tweets.includes(ancestorTweet)) {
        tweets.push(ancestorTweet);
      }
    }

    if (!isOwnButton && subtreeContainsButton(rootNode)) {
      const ancestorUserCell = findAncestorUserCell(rootNode);

      if (ancestorUserCell && !userCells.includes(ancestorUserCell)) {
        userCells.push(ancestorUserCell);
      }
    }

    if (nodeMatchesOrContains(rootNode, SELECTORS.profileActionsButton)) {
      attachButtonToProfilePage(documentRef);
    }

    for (const tweet of tweets) {
      attachButtonToTweet(tweet, documentRef);
    }

    for (const userCell of userCells) {
      attachButtonToUserCell(userCell, documentRef);
    }
  }

  const domExports = {
    attachButtonToProfilePage,
    attachButtonToTweet,
    attachButtonToUserCell,
    collectTweets,
    collectUserCells,
    findAncestorUserCell,
    findManagedButtonByAction,
    findProfileActionBar,
    findActionRowContainer,
    findPrimaryActionWrapper,
    findUserCellActionBar,
    USER_CELL_ACTIONS_ATTRIBUTE,
    getElementChildren,
    processNode,
    subtreeContainsButton
  };

  Object.assign(namespace, domExports);

  if (typeof module !== 'undefined') {
    module.exports = domExports;
  }
})();
