// Lanternleaf Tea Co. — tiny interactive greeting
function greetVisitor() {
  const now = new Date();
  const hour = now.getHours();
  let timeOfDay = "day";
  if (hour < 12) {
    timeOfDay = "morning";
  } else if (hour >= 18) {
    timeOfDay = "evening";
  }
  const message = `Good ${timeOfDay}! Thanks for stopping by Lanternleaf Tea Co.`;
  console.log(message);
  const intro = document.getElementById("intro");
  if (intro) {
    intro.textContent = message;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("greetBtn");
  if (btn) {
    btn.addEventListener("click", greetVisitor);
  }
});
