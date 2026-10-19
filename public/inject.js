// Injected into Immich's web app by the Gearbox proxy: adds a "Gearbox" item to the
// sidebar after "Sharing" (and after Folio's item, if Folio is installed too). It clones
// Immich's own link so it inherits the current look, and quietly does nothing if
// Immich's markup ever changes.
(() => {
  const ID = 'gearbox-sidebar-link';
  // mdi "camera", the icon set Immich itself uses.
  const ICON = 'M4,4H7L9,2H15L17,4H20A2,2 0 0,1 22,6V18A2,2 0 0,1 20,20H4A2,2 0 0,1 2,18V6A2,2 0 0,1 4,4M12,7A5,5 0 0,0 7,12A5,5 0 0,0 12,17A5,5 0 0,0 17,12A5,5 0 0,0 12,7M12,9A3,3 0 0,1 15,12A3,3 0 0,1 12,15A3,3 0 0,1 9,12A3,3 0 0,1 12,9Z';

  function textNodes(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const out = [];
    while (walker.nextNode()) if (walker.currentNode.nodeValue.trim()) out.push(walker.currentNode);
    return out;
  }

  // The outermost wrapper that only contains this link.
  function itemOf(anchor) {
    let item = anchor;
    while (item.parentElement && item.parentElement.children.length === 1 && item.parentElement.tagName !== 'NAV') {
      item = item.parentElement;
    }
    return item;
  }

  function insert() {
    if (document.getElementById(ID)) return;
    const anchor = document.querySelector('nav a[href="/sharing"], aside a[href="/sharing"], a[href="/sharing"]');
    if (!anchor) return;

    const item = itemOf(anchor);
    const clone = item.cloneNode(true);
    clone.id = ID;
    const link = clone.matches('a') ? clone : clone.querySelector('a');
    link.href = '/gearbox';
    link.setAttribute('data-sveltekit-reload', '');
    link.removeAttribute('aria-current');
    link.setAttribute('title', 'Gearbox');
    for (const node of clone.querySelectorAll('[aria-current]')) node.removeAttribute('aria-current');
    const labels = textNodes(clone);
    if (labels.length) {
      labels[0].nodeValue = labels[0].nodeValue.replace(/\S.*\S|\S/, 'Gearbox');
      labels.slice(1).forEach((n) => (n.nodeValue = ''));
    }
    clone.querySelectorAll('svg path').forEach((p) => {
      p.setAttribute('d', ICON);
      p.removeAttribute('fill-rule');
    });
    (document.getElementById('folio-sidebar-link') || item).after(clone);
  }

  // Keep Gearbox right below Folio, whichever script runs first.
  function reorder() {
    const mine = document.getElementById(ID);
    const folio = document.getElementById('folio-sidebar-link');
    if (mine && folio && folio.nextElementSibling !== mine && folio.parentElement === mine.parentElement) folio.after(mine);
  }

  const observer = new MutationObserver(() => { insert(); reorder(); });
  const start = () => {
    insert();
    observer.observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
