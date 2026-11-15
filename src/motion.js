/* Five Sides — motion layer.
 *
 * Each side is cut to the animation that produced it: eighteen scenes, one per
 * bar, taken from the published NASA animation at the exact instants the stills
 * were measured from. A bar plays its scene slowed to the bar's length, so the
 * picture keeps moving inside the music instead of cutting between stills.
 *
 * The video is never shown directly. It is drawn into the stage canvas, so the
 * playhead, the activity columns and the "Show NASA frame" switch all keep
 * working over moving pictures exactly as they did over stills.
 *
 * window.Motion = { make, ready, sceneOf, syncBar, play, pause, restart, drop }
 */
(function () {
  "use strict";

  // A video that is display:none stops decoding in some browsers, so park it
  // offscreen at 1px and draw from it.
  const HIDE = {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: "2px",
    height: "2px",
    opacity: "0",
    pointerEvents: "none",
  };

  function make(src) {
    const v = document.createElement("video");
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.setAttribute("muted", "");
    v.setAttribute("aria-hidden", "true");
    v.setAttribute("tabindex", "-1");
    v.preload = "auto";
    v.loop = false;
    Object.assign(v.style, HIDE);
    v.src = src;
    document.body.appendChild(v);
    v.load();
    return v;
  }

  function ready(v) {
    return !!v && v.readyState >= 2 && v.videoWidth > 0;
  }

  function sceneOf(motion, index) {
    return index * motion.slice;
  }

  /* Put the picture where the music is. Called on every bar change. */
  function syncBar(video, motion, index, barDur) {
    if (!video || !motion) return;
    const start = sceneOf(motion, index);
    // Reseek only when the picture has drifted out of its own scene; a seek
    // stutters, and the picture is allowed to run a little ahead.
    const drift = video.currentTime - start;
    if (drift < -0.05 || drift > motion.slice * 0.9) {
      try {
        video.currentTime = start + 0.001;
      } catch (e) {
        /* not seekable yet — the next bar will catch it */
      }
    }
    // One scene per bar: how much the animation is slowed to fit the music.
    const rate = motion.slice / Math.max(0.4, barDur || motion.slice);
    const clamped = Math.max(0.2, Math.min(2, rate));
    if (Math.abs(video.playbackRate - clamped) > 0.02) {
      try {
        video.playbackRate = clamped;
      } catch (e) {
        /* older browsers: playbackRate is read-only on some media */
      }
    }
  }

  function play(video) {
    if (!video) return;
    const p = video.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }

  function pause(video) {
    if (!video) return;
    try {
      video.pause();
    } catch (e) {
      /* already paused */
    }
  }

  function restart(video, motion) {
    if (!video || !motion) return;
    try {
      video.currentTime = 0;
    } catch (e) {
      /* not seekable yet */
    }
  }

  function drop(video) {
    if (!video) return;
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
    } catch (e) {
      /* already gone */
    }
  }

  window.Motion = { make, ready, sceneOf, syncBar, play, pause, restart, drop };
})();
