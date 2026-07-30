// CopperKettle page script: greets the visitor and lets the button
// toggle a warm highlight on the product blurb.

function setupGreeting(buttonId, blurbId) {
  var button = document.getElementById(buttonId);
  var blurb = document.getElementById(blurbId);

  console.log("Hello from CopperKettle — the kettle page has loaded!");

  if (!button || !blurb) {
    return;
  }

  button.addEventListener("click", function () {
    if (blurb.style.backgroundColor === "rgb(255, 232, 200)") {
      blurb.style.backgroundColor = "";
      button.textContent = "Say hello";
    } else {
      blurb.style.backgroundColor = "#ffe8c8";
      button.textContent = "Hello, camper!";
    }
    console.log("CopperKettle says hi!");
  });
}

document.addEventListener("DOMContentLoaded", function () {
  setupGreeting("greet-button", "product-blurb");
});
