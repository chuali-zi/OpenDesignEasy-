// Ember Mug Co. — tiny interaction for the landing page

function sayHello() {
  const greetings = [
    "Your drink stays warm. So does our welcome.",
    "55°C of cozy, coming right up.",
    "No more lukewarm sips — hello from The Little Warmer!"
  ];
  const message = greetings[Math.floor(Math.random() * greetings.length)];
  console.log("Ember Mug Co. says:", message);
  const btn = document.getElementById("greet-btn");
  if (btn) {
    btn.textContent = message;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("greet-btn");
  if (btn) {
    btn.addEventListener("click", sayHello);
  }
  console.log("Ember Mug Co. page loaded. Click the button for a warm greeting.");
});
