// Three small enhancements. The page reads fine without any of them.
//   1. Offer the download that matches the visitor's system.
//   2. Install tabs.
//   3. A Copy button on code blocks, and the popup demo scaled to fit narrow screens.

(function () {
  var UNIX = 'https://github.com/FernandoHN99/flux-downloader/releases/latest/download/flux-downloader-portable.tar.gz';
  var WINDOWS = 'https://github.com/FernandoHN99/flux-downloader/releases/latest/download/FluxDownloader-Setup-win-x64.exe';

  // --- 1. The right download first -------------------------------------------
  var platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '';
  var onWindows = /win/i.test(platform);
  var download = document.getElementById('download');
  var other = document.getElementById('download-other');
  if (onWindows && download && other) {
    download.href = WINDOWS;
    download.textContent = 'Download for Windows';
    var note = document.getElementById('download-note');
    other.textContent = 'Get the macOS and Linux archive';
    other.href = UNIX;
    if (note && note.firstChild) note.firstChild.textContent = 'Using macOS or Linux? ';
  }

  // --- 2. Install tabs -----------------------------------------------------------
  document.querySelectorAll('[data-tabs]').forEach(function (group) {
    var tabs = Array.prototype.slice.call(group.querySelectorAll('[role="tab"]'));
    function select(tab) {
      tabs.forEach(function (item) {
        var on = item === tab;
        item.setAttribute('aria-selected', String(on));
        item.tabIndex = on ? 0 : -1;
        document.getElementById(item.getAttribute('aria-controls')).hidden = !on;
      });
    }
    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () { select(tab); });
      tab.addEventListener('keydown', function (event) {
        var next = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
        if (!next) return;
        var target = tabs[(index + next + tabs.length) % tabs.length];
        select(target);
        target.focus();
        event.preventDefault();
      });
    });
    select(onWindows ? tabs[1] : tabs[0]);
  });

  // --- 3. Copy buttons and the demo's size -----------------------------------------
  document.querySelectorAll('.code').forEach(function (block) {
    var button = block.querySelector('.copy');
    var code = block.querySelector('code');
    if (!button || !code || !navigator.clipboard) {
      if (button) button.hidden = true;
      return;
    }
    button.addEventListener('click', function () {
      navigator.clipboard.writeText(code.textContent).then(function () {
        button.textContent = 'Copied';
        setTimeout(function () { button.textContent = 'Copy'; }, 1600);
      });
    });
  });

  // The popup is 500px wide and cannot reflow, so on a narrower screen the
  // whole frame is scaled down rather than scrolled sideways.
  var frame = document.querySelector('[data-demo]');
  var iframe = frame && frame.querySelector('iframe');
  function fit() {
    if (!frame || !iframe) return;
    var scale = Math.min(1, frame.clientWidth / 500);
    iframe.style.transform = scale < 1 ? 'scale(' + scale + ')' : '';
    frame.style.height = Math.round(580 * scale) + 'px';
  }
  fit();
  window.addEventListener('resize', fit);
})();
