(() => {
  "use strict";

  // Ordinary UI config -- not a "mock data" record shape, on purpose, to
  // stress-test the detector for false positives on innocuous objects.
  const siteConfig = {
    primaryColor: "#1c1c1c",
    accentColor: "#ff5a36",
    maxWidth: 960,
    theme: "light",
  };

  // A plain array of strings (menu labels). No object entries, no
  // id/name/title/message-style fields -- should not read as fake data.
  const navLabels = ["Home", "Work", "About", "Contact"];

  const navToggle = document.getElementById("navToggle");
  navToggle.addEventListener("click", () => {
    const expanded = navToggle.getAttribute("aria-expanded") === "true";
    navToggle.setAttribute("aria-expanded", String(!expanded));
    document.body.classList.toggle("nav-open", !expanded);
  });

  document.querySelectorAll(".faq-item").forEach((item) => {
    const question = item.querySelector(".faq-q");
    const answer = item.querySelector(".faq-a");
    question.addEventListener("click", () => {
      answer.hidden = !answer.hidden;
    });
  });

  // Purely cosmetic timer (a clock), not simulating a network response.
  function tickClock() {
    const el = document.querySelector("[data-oey-object='footer.copyright']");
    if (!el) return;
    const now = new Date();
    el.title = `Rendered at ${now.toLocaleTimeString()}`;
  }
  setInterval(tickClock, 60000);

  void siteConfig;
  void navLabels;
})();
