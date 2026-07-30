function sayHello() {
  console.log("Hello from the Pocket Lantern! May your nights stay bright.");
  const heading = document.querySelector("h1");
  if (heading) {
    heading.textContent = heading.textContent.includes("🔦")
      ? "Pocket Lantern"
      : "Pocket Lantern 🔦";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const button = document.getElementById("greet-btn");
  if (button) {
    button.addEventListener("click", sayHello);
  }
});
