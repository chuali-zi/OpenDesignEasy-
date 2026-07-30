// Logs a warm greeting and toggles the heading color when clicked.
function greetAndSetupToggle() {
  console.log("Welcome to Kettle Buddy — your tea's best friend!");

  const heading = document.querySelector('h1');
  if (!heading) {
    return;
  }

  heading.addEventListener('click', function () {
    heading.style.color =
      heading.style.color === 'rgb(217, 165, 102)' ? '' : '#d9a566';
    console.log('Heading color toggled. Fancy!');
  });
}

greetAndSetupToggle();
