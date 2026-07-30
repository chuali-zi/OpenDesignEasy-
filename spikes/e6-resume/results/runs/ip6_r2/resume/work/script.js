// Toggle a warm "lamp on" glow on the page when the button is clicked.
function toggleLampGlow() {
  var isOn = document.body.classList.toggle("lamp-on");
  document.body.style.backgroundColor = isOn ? "#ffe9c4" : "#f6f1e7";
  console.log(isOn ? "Pebblelamp is glowing warmly." : "Pebblelamp is off.");
}

document.getElementById("greet-btn").addEventListener("click", toggleLampGlow);
