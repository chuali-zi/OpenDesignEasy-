// PebblePod demo site — small interaction script

function greet() {
  const hour = new Date().getHours();
  let timeOfDay = "day";
  if (hour < 12) {
    timeOfDay = "morning";
  } else if (hour >= 18) {
    timeOfDay = "evening";
  }
  const message = `Good ${timeOfDay}! Your plants say thanks for checking in.`;
  console.log(message);
  alert(message);
}

document.addEventListener("DOMContentLoaded", function () {
  const btn = document.getElementById("greet-btn");
  if (btn) {
    btn.addEventListener("click", greet);
  }
  console.log("PebblePod page loaded. Click 'Say hello' for a greeting.");
});
