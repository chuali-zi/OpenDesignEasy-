// Attaches a click handler to the "Say hello" button that logs a greeting
// and briefly changes the button's label.
function greetFromPebbleDock() {
  console.log("Hello from PebbleDock — your desk just got a little calmer.");
  var button = document.getElementById("greet-button");
  if (!button) {
    return;
  }
  var originalLabel = button.textContent;
  button.textContent = "Charging...";
  button.disabled = true;
  setTimeout(function () {
    button.textContent = originalLabel;
    button.disabled = false;
  }, 2000);
}

document.addEventListener("DOMContentLoaded", function () {
  var button = document.getElementById("greet-button");
  if (button) {
    button.addEventListener("click", greetFromPebbleDock);
  }
});
