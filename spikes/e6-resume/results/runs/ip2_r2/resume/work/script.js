function greet() {
  console.log("Hello from Driftwood Kettle Co.!");
  const heading = document.querySelector("h1");
  heading.textContent =
    heading.textContent === "Driftwood Kettle Co."
      ? "Welcome, tea friend!"
      : "Driftwood Kettle Co.";
}

document.getElementById("greet-btn").addEventListener("click", greet);
