// Toggles the warm "glow" theme on the page when the button is clicked.
function toggleGlow() {
  document.body.classList.toggle('glowing');
  const isGlowing = document.body.classList.contains('glowing');
  console.log(isGlowing ? 'The Lumen Jar is glowing.' : 'The Lumen Jar is dim.');
}

document.addEventListener('DOMContentLoaded', () => {
  const button = document.getElementById('glow-button');
  if (button) {
    button.addEventListener('click', toggleGlow);
  }
});
