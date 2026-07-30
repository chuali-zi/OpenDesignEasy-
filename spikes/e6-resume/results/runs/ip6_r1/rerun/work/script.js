// Greets the visitor and wires up the "Say hello" button.
function greet(name) {
  const message = `Hello, ${name}! Your Pocket Kettle is warming up.`;
  console.log(message);
  return message;
}

document.addEventListener('DOMContentLoaded', () => {
  greet('tea lover');

  const button = document.getElementById('greet-btn');
  if (button) {
    button.addEventListener('click', () => {
      button.textContent = 'Kettle is boiling!';
      greet('button clicker');
    });
  }
});
