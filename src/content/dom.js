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
    if (!node || node.nodeType !== 1) {
      return false;
    }

    if (typeof node.matches === 'function' && node.matches(selector)) {
      return true;
    }

    return typeof node.querySelector === 'function' && Boolean(node.querySelector(selector));
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

  function processNode(rootNode) {
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

    for (const tweet of tweets) {
      attachButtonToTweet(tweet);
    }
  }

  const domExports = {
    attachButtonToTweet,
    collectTweets,
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
