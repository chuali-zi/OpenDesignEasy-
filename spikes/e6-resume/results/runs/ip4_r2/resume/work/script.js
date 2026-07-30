// Greets the visitor and lets them toggle the "glow" of the page heading,
// mimicking Moonjar's sunrise effect.
function greetAndEnableGlow() {
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  console.log(`Good ${timeOfDay}! Welcome to Moonjar.`);

  const heading = document.querySelector('h1');
  if (!heading) return;

  heading.style.cursor = 'pointer';
  heading.title = 'Click to toggle the glow';

  heading.addEventListener('click', function toggleGlow() {
    const glowing = heading.classList.toggle('glowing');
    heading.style.textShadow = glowing ? '0 0 18px #f4b860, 0 0 40px #f4b860' : 'none';
  });
}

document.addEventListener('DOMContentLoaded', greetAndEnableGlow);
