// Lanternbug greeting: toggles a glow class on the heading and logs a hello.
function sayHello() {
  const heading = document.querySelector("h1");
  const glowing = heading.classList.toggle("glowing");
  heading.textContent = glowing ? "Lanternbug says hi!" : "Lanternbug";
  console.log("Hello from Lanternbug! Glow is now " + (glowing ? "on" : "off") + ".");
}

document.getElementById("greet-btn").addEventListener("click", sayHello);
