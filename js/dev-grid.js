/* ==========================================================================
   Dev grid: press G (or open the page with ?grid) to overlay the layout grid
   from Figma: 8 columns, 50px margins, 20px gutters, guides on columns 3 and 6.
   It reads the same CSS tokens as the layout (--grid-pad, --grid-gap), so it
   follows the page at every width. Nothing else on the page depends on it.
   ========================================================================== */
(function () {
  'use strict';
  var el = null;

  function build() {
    el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;' +
      'display:grid;grid-template-columns:repeat(var(--grid-cols,8),minmax(0,1fr));' +
      'column-gap:var(--grid-gap,1.25rem);padding-inline:var(--grid-pad,3.125rem);';
    for (var i = 1; i <= 8; i++) {
      var col = document.createElement('i');
      var guide = i === 3 || i === 6;            /* the guides from Figma */
      col.style.cssText = 'display:block;background:' + (guide ? 'rgba(0,190,255,.16)' : 'rgba(255,0,90,.09)') + ';' +
        (guide ? 'box-shadow:inset 1px 0 0 rgba(0,170,255,.95);' : '');
      el.appendChild(col);
    }
    document.body.appendChild(el);
  }

  function toggle() {
    if (el) { el.remove(); el = null; } else build();
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'g' && e.key !== 'G') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = document.activeElement && document.activeElement.tagName;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(t || '')) return;
    toggle();
  });

  if (/[?&]grid(\b|=)/.test(location.search)) build();
})();
