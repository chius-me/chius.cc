---
title: "关于"
description: "关于我和这个博客"
showWordCount: false
showReadingTime: false
showRelatedContent: false
showPagination: false
showComments: false
layoutBackgroundHeaderSpace: false
---

## 关于我

我是 Chius，一名 UPC 在读本科生，同时也是开发者、Homelabber 和 Linux 爱好者。

## 我的其他站点

[social.chius.cc](https://social.chius.cc/@chius) 这是我的 [Fediverse](https://jointhefediverse.net/) ,去中心化的社交网络平台。  
[status.chius.cc](https://status.chius.cc/) 这是我的监控站点，依托于 Cloudflare。  
[ilist.chius.cc](https://ilist.chius.workers.dev/) 这是我的公开资源分享站点，挂载了我的 onedrive 和 google drive。

## 关于这个博客

本站基于 [Hugo](https://gohugo.io/) 和 [Blowfish](https://blowfish.page/) 主题构建，托管于 [Cloudflare](https://www.cloudflare.com/)。

<script src='https://storage.ko-fi.com/cdn/scripts/overlay-widget.js'></script>
<script>
  kofiWidgetOverlay.draw('chius', {
    'type': 'floating-chat',
    'floating-chat.donateButton.text': 'Support me',
    'floating-chat.donateButton.background-color': '#f45d22',
    'floating-chat.donateButton.text-color': '#fff'
  });
</script>
<script>
document.addEventListener('DOMContentLoaded', function() {
  var toggle = document.getElementById('mobile-menu-toggle');
  if (!toggle) return;
  var selectors = '.floatingchat-container-wrapper,[id*="kofi"],[id*="floatingchat"]';
  function setKofi(show) {
    document.querySelectorAll(selectors).forEach(function(el) {
      if (el.style) el.style.display = show ? '' : 'none';
    });
  }
  var timer;
  toggle.addEventListener('change', function() {
    clearInterval(timer);
    if (this.checked) {
      setKofi(false);
      timer = setInterval(function() { setKofi(false); }, 200);
    } else {
      setKofi(true);
    }
  });
});
</script>
