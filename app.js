'use strict';

// Highlight the current section, clearing the highlight above the first section.
const sectionLinks = [...document.querySelectorAll('nav a[href^="#"]')];
const sections = sectionLinks.map(link => document.querySelector(link.hash)).filter(Boolean);
let scheduled = false;
function updateCurrentSection() {
  scheduled = false;
  const threshold = Math.min(220, innerHeight * .3);
  const current = sections.filter(section => section.getBoundingClientRect().top <= threshold).at(-1);
  sectionLinks.forEach(link => {
    if (current && link.hash === `#${current.id}`) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}
function scheduleUpdate() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(updateCurrentSection);
}
addEventListener('scroll', scheduleUpdate, { passive: true });
addEventListener('resize', scheduleUpdate);
updateCurrentSection();
