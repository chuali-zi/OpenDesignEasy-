function greet() {
  var intro = document.getElementById("intro");
  console.log("Hello from SproutBox!");
  if (intro) {
    intro.style.borderColor = intro.style.borderColor === "rgb(60, 122, 60)" ? "#d7e6d4" : "#3c7a3c";
  }
}

document.addEventListener("DOMContentLoaded", function () {
  var btn = document.getElementById("greet-btn");
  if (btn) {
    btn.addEventListener("click", greet);
  }
});
