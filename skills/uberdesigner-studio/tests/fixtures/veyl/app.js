// The prologue's second line comes in once the pinned stage is half scrolled through
const prologue = document.querySelector(".prologue");
const sub = document.querySelector(".prologue__sub");
const story = document.querySelector(".story");
const stage = document.querySelector(".story__stage");
const scenes = [...document.querySelectorAll(".story__scene")];
const onScroll = () => {
  const span = prologue.offsetHeight - window.innerHeight;
  const progress = span > 0 ? Math.min(1, Math.max(0, window.scrollY / span)) : 1;
  sub.classList.toggle("is-in", progress > 0.5);
  // The story: live once the page is a screen into it, then one line per 0.8 of a screen
  const into = window.scrollY - story.offsetTop;
  const live = into > window.innerHeight && into < story.offsetHeight - window.innerHeight * 0.5;
  stage.classList.toggle("is-live", live);
  const on = Math.min(scenes.length - 1, Math.floor((into - window.innerHeight) / (window.innerHeight * 0.8)));
  scenes.forEach((s, i) => s.classList.toggle("is-on", live && i === on));
};
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

// A dock the script adds to the page by itself, in no section and so in no layer (an app mock-up or a preloader a
// script builds does the same): its light pulses in CSS
const dock = document.createElement("div");
dock.className = "dock";
dock.innerHTML = '<span class="dock__light"></span><p class="dock__label">Looms running</p>';
document.body.append(dock);
