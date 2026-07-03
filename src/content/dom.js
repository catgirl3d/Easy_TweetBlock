(() => {
  if (typeof module !== 'undefined' && module.exports) {
    require('./shared.js');
  }

  const namespace = globalThis.EasyTweetBlockContent || (globalThis.EasyTweetBlockContent = {});
  const {
    BLOCK_BUTTON_ATTRIBUTE,
    SELECTORS
  } = namespace;

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

  function processNode(rootNode, documentRef = document) {
    const tweets = collectTweets(rootNode);
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

    if (nodeMatchesOrContains(rootNode, SELECTORS.profileActionsButton)) {
      attachButtonToProfilePage(documentRef);
    }

    for (const tweet of tweets) {
      attachButtonToTweet(tweet, documentRef);
    }
  }

  const domExports = {
    attachButtonToProfilePage,
    attachButtonToTweet,
    collectTweets,
    findProfileActionBar,
    findActionRowContainer,
    findPrimaryActionWrapper,
    getElementChildren,
    processNode,
    subtreeContainsButton
  };

  Object.assign(namespace, domExports);

  if (typeof module !== 'undefined') {
    module.exports = domExports;
  }
})();
