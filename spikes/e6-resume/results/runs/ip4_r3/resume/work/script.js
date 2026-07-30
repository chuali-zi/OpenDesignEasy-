function greetGardener() {
  var message = "Welcome to PocketSprout! Your moss garden awaits.";
  console.log(message);
  var heading = document.querySelector("h1");
  if (heading) {
    heading.textContent = heading.textContent === "PocketSprout Terrarium Kits"
      ? "Hello, gardener!"
      : "PocketSprout Terrarium Kits";
  }
}

document.addEventListener("DOMContentLoaded", function () {
  greetGardener();
  var button = document.getElementById("greet-btn");
  if (button) {
    button.addEventListener("click", greetGardener);
  }
});
