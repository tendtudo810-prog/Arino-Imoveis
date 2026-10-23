(function () {
  var bg = document.getElementById('bg');
  var video = document.getElementById('bgVideo');
  var canvas = document.getElementById('bgCanvas');
  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var MAX_W = 960, FPS = 30;
  var frames = [], lastT = -1, capturing = false, started = false;
  function grab() {
    if (!capturing) return;
    var t = video.currentTime;
    if (t !== lastT && video.videoWidth) {
      lastT = t;
      var w = Math.min(MAX_W, video.videoWidth);
      var h = Math.round(video.videoHeight * w / video.videoWidth);
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(video, 0, 0, w, h);
      frames.push(c);
    }
    next();
  }
  function next() {
    if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(grab);
    else requestAnimationFrame(grab);
  }
  function startCapture() { if (started) return; started = true; capturing = true; next(); }
  function onEnded() {
    capturing = false;
    if (frames.length < 2) return;
    canvas.width = frames[0].width;
    canvas.height = frames[0].height;
    ctx.drawImage(frames[0], 0, 0);
    bg.classList.add('ready');
    if (reduce) return;
    var n = frames.length, seq = [], i, k = 0;
    for (i = 0; i < n; i++) seq.push(i);
    for (i = n - 2; i >= 1; i--) seq.push(i);
    setInterval(function () {
      ctx.drawImage(frames[seq[k]], 0, 0, canvas.width, canvas.height);
      k = (k + 1) % seq.length;
    }, 1000 / FPS);
  }
  var retried = false;
  function retryWithoutCors() {
    if (retried || !video.hasAttribute('crossorigin')) return;
    retried = true;
    video.removeAttribute('crossorigin');
    video.src = video.currentSrc || video.src;
    video.load();
    var r = video.play();
    if (r && r.catch) r.catch(function () {});
  }
  video.addEventListener('playing', startCapture);
  video.addEventListener('ended', onEnded);
  video.addEventListener('error', function () {
    if (video.hasAttribute('crossorigin') && !retried) retryWithoutCors();
    else video.style.display = 'none';
  });
  setTimeout(function () { if (video.readyState < 2) retryWithoutCors(); }, 4000);
  var p = video.play();
  if (p && p.catch) p.catch(function () {});
})();