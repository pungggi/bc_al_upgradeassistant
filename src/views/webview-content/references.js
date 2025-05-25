// Global state
let expandedItems = new Set();

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  initializeEventListeners();
  initializeExpandedState();
});

/**
 * Initialize all event listeners
 */
function initializeEventListeners() {
  // Toolbar buttons
  document.getElementById('refresh-btn')?.addEventListener('click', () => {
    sendMessage({ command: 'refresh' });
  });

  document.getElementById('filter-done-btn')?.addEventListener('click', () => {
    sendMessage({ command: 'filterDone' });
  });

  document.getElementById('filter-not-done-btn')?.addEventListener('click', () => {
    sendMessage({ command: 'filterNotDone' });
  });

  document.getElementById('clear-filters-btn')?.addEventListener('click', () => {
    sendMessage({ command: 'clearFilters' });
  });

  // Tree item interactions
  document.addEventListener('click', handleTreeClick);
  document.addEventListener('dblclick', handleTreeDoubleClick);
}

/**
 * Initialize expanded state from data
 */
function initializeExpandedState() {
  if (typeof data !== 'undefined' && data.items) {
    collectExpandedItems(data.items);
  }
}

/**
 * Collect expanded items from tree data
 */
function collectExpandedItems(items) {
  items.forEach(item => {
    if (item.collapsibleState === 1) { // Expanded
      expandedItems.add(item.id);
    }
    if (item.children) {
      collectExpandedItems(item.children);
    }
  });
}

/**
 * Handle tree item clicks
 */
function handleTreeClick(event) {
  const target = event.target.closest('[data-action]');
  if (target) {
    event.preventDefault();
    event.stopPropagation();
    handleActionClick(target);
    return;
  }

  const expandIcon = event.target.closest('.expand-icon');
  if (expandIcon) {
    event.preventDefault();
    event.stopPropagation();
    handleExpandToggle(expandIcon);
    return;
  }

  const treeItem = event.target.closest('.tree-item');
  if (treeItem) {
    selectTreeItem(treeItem);
  }
}

/**
 * Handle tree item double clicks
 */
function handleTreeDoubleClick(event) {
  const treeItem = event.target.closest('.tree-item');
  if (treeItem) {
    const itemContent = treeItem.querySelector('.item-content');
    const itemId = itemContent?.getAttribute('data-item-id');
    if (itemId) {
      sendMessage({ command: 'openReference', itemId });
    }
  }
}

/**
 * Handle action button clicks
 */
function handleActionClick(button) {
  const action = button.getAttribute('data-action');
  const itemId = button.getAttribute('data-item-id');
  const url = button.getAttribute('data-url');

  switch (action) {
    case 'toggleDone':
      sendMessage({ command: 'toggleDone', itemId });
      break;
    case 'addNote':
      sendMessage({ command: 'addNote', itemId });
      break;
    case 'toggleNotImplemented':
      sendMessage({ command: 'toggleNotImplemented', itemId });
      break;
    case 'openUrl':
      sendMessage({ command: 'openUrl', url });
      break;
  }
}

/**
 * Handle expand/collapse toggle
 */
function handleExpandToggle(expandIcon) {
  const itemId = expandIcon.getAttribute('data-item-id');
  const isExpanded = expandIcon.classList.contains('expanded');
  const newExpandedState = !isExpanded;

  // Update local state
  if (newExpandedState) {
    expandedItems.add(itemId);
  } else {
    expandedItems.delete(itemId);
  }

  // Update UI immediately for responsiveness
  updateExpandIcon(expandIcon, newExpandedState);
  toggleChildrenVisibility(expandIcon.closest('.tree-item'), newExpandedState);

  // Notify extension
  sendMessage({ 
    command: 'toggleExpand', 
    itemId, 
    expanded: newExpandedState 
  });
}

/**
 * Update expand icon state
 */
function updateExpandIcon(expandIcon, expanded) {
  if (expanded) {
    expandIcon.classList.add('expanded');
  } else {
    expandIcon.classList.remove('expanded');
  }
}

/**
 * Toggle visibility of child items
 */
function toggleChildrenVisibility(treeItem, show) {
  const childList = treeItem.querySelector(':scope > .tree-list');
  if (childList) {
    if (show) {
      childList.style.display = 'block';
      childList.style.maxHeight = 'none';
    } else {
      childList.style.display = 'none';
      childList.style.maxHeight = '0';
    }
  }
}

/**
 * Select a tree item
 */
function selectTreeItem(treeItem) {
  // Remove previous selection
  document.querySelectorAll('.tree-item.selected').forEach(item => {
    item.classList.remove('selected');
  });

  // Add selection to clicked item
  treeItem.classList.add('selected');
}

/**
 * Send message to VS Code extension
 */
function sendMessage(message) {
  if (typeof vscode !== 'undefined') {
    vscode.postMessage(message);
  } else {
    console.log('Would send message:', message);
  }
}

/**
 * Handle keyboard navigation
 */
document.addEventListener('keydown', function(event) {
  const selectedItem = document.querySelector('.tree-item.selected');
  if (!selectedItem) return;

  switch (event.key) {
    case 'ArrowUp':
      event.preventDefault();
      navigateUp(selectedItem);
      break;
    case 'ArrowDown':
      event.preventDefault();
      navigateDown(selectedItem);
      break;
    case 'ArrowLeft':
      event.preventDefault();
      collapseItem(selectedItem);
      break;
    case 'ArrowRight':
      event.preventDefault();
      expandItem(selectedItem);
      break;
    case 'Enter':
      event.preventDefault();
      const itemContent = selectedItem.querySelector('.item-content');
      const itemId = itemContent?.getAttribute('data-item-id');
      if (itemId) {
        sendMessage({ command: 'openReference', itemId });
      }
      break;
    case ' ':
      event.preventDefault();
      const toggleBtn = selectedItem.querySelector('.toggle-done-btn');
      if (toggleBtn) {
        handleActionClick(toggleBtn);
      }
      break;
  }
});

/**
 * Navigate to previous visible item
 */
function navigateUp(currentItem) {
  const allItems = Array.from(document.querySelectorAll('.tree-item'));
  const currentIndex = allItems.indexOf(currentItem);
  
  for (let i = currentIndex - 1; i >= 0; i--) {
    const item = allItems[i];
    if (isItemVisible(item)) {
      selectTreeItem(item);
      item.scrollIntoView({ block: 'nearest' });
      break;
    }
  }
}

/**
 * Navigate to next visible item
 */
function navigateDown(currentItem) {
  const allItems = Array.from(document.querySelectorAll('.tree-item'));
  const currentIndex = allItems.indexOf(currentItem);
  
  for (let i = currentIndex + 1; i < allItems.length; i++) {
    const item = allItems[i];
    if (isItemVisible(item)) {
      selectTreeItem(item);
      item.scrollIntoView({ block: 'nearest' });
      break;
    }
  }
}

/**
 * Check if item is visible (not hidden by collapsed parent)
 */
function isItemVisible(item) {
  let parent = item.parentElement;
  while (parent && parent !== document.body) {
    if (parent.style.display === 'none') {
      return false;
    }
    parent = parent.parentElement;
  }
  return true;
}

/**
 * Expand an item
 */
function expandItem(treeItem) {
  const expandIcon = treeItem.querySelector('.expand-icon');
  if (expandIcon && !expandIcon.classList.contains('expanded')) {
    handleExpandToggle(expandIcon);
  }
}

/**
 * Collapse an item
 */
function collapseItem(treeItem) {
  const expandIcon = treeItem.querySelector('.expand-icon');
  if (expandIcon && expandIcon.classList.contains('expanded')) {
    handleExpandToggle(expandIcon);
  }
}

/**
 * Update toolbar button states
 */
function updateToolbarStates(filterMode) {
  document.querySelectorAll('.toolbar-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  switch (filterMode) {
    case 'done':
      document.getElementById('filter-done-btn')?.classList.add('active');
      break;
    case 'notDone':
      document.getElementById('filter-not-done-btn')?.classList.add('active');
      break;
    case 'all':
    default:
      document.getElementById('clear-filters-btn')?.classList.add('active');
      break;
  }
}

/**
 * Initialize toolbar states when data is available
 */
if (typeof data !== 'undefined') {
  updateToolbarStates(data.filterMode);
}

/**
 * Handle context menu (right-click)
 */
document.addEventListener('contextmenu', function(event) {
  const treeItem = event.target.closest('.tree-item');
  if (treeItem) {
    event.preventDefault();
    selectTreeItem(treeItem);
    
    // Show context menu actions
    const itemContent = treeItem.querySelector('.item-content');
    const contextValue = itemContent?.getAttribute('data-context-value');
    
    if (contextValue) {
      showContextMenu(event, contextValue, itemContent.getAttribute('data-item-id'));
    }
  }
});

/**
 * Show context menu
 */
function showContextMenu(event, contextValue, itemId) {
  // For now, just trigger the most common action
  if (contextValue.includes('documentationRef')) {
    const toggleBtn = event.target.closest('.tree-item').querySelector('.toggle-done-btn');
    if (toggleBtn) {
      handleActionClick(toggleBtn);
    }
  }
}

/**
 * Handle window resize
 */
window.addEventListener('resize', function() {
  // Adjust layout if needed
  const content = document.querySelector('.content');
  if (content) {
    content.style.height = `calc(100vh - ${document.querySelector('.header').offsetHeight}px)`;
  }
});

/**
 * Utility function to debounce function calls
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Export functions for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sendMessage,
    handleActionClick,
    handleExpandToggle,
    selectTreeItem,
    navigateUp,
    navigateDown,
    expandItem,
    collapseItem
  };
}
