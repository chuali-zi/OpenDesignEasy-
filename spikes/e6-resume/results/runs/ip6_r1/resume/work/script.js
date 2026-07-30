// Moonbeam Mug — tiny page script
function greetVisitor() {
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  console.log(`Good ${timeOfDay}! Welcome to the Moonbeam Mug page.`);
}

greetVisitor();
