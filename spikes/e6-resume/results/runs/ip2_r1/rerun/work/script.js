// Logs a greeting and wires up the "Say hello" button to toggle
// a friendly message on the page.
function greet() {
  var message = 'Hello from Moss & Ember — light a candle, plant a tree!';
  console.log(message);

  var note = document.getElementById('greeting-note');
  if (!note) {
    note = document.createElement('p');
    note.id = 'greeting-note';
    document.body.appendChild(note);
  }
  note.textContent = message;
}

document.addEventListener('DOMContentLoaded', function () {
  greet();
  var btn = document.getElementById('greet-btn');
  if (btn) {
    btn.addEventListener('click', greet);
  }
});
