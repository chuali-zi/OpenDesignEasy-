function greetCamper() {
  var message = "Welcome, camper! The Cloverleaf Lantern is charged and ready.";
  console.log(message);
  var button = document.getElementById("greet-btn");
  if (button) {
    button.textContent = message;
  }
}

document.addEventListener("DOMContentLoaded", function () {
  var button = document.getElementById("greet-btn");
  if (button) {
    button.addEventListener("click", greetCamper);
  }
});
