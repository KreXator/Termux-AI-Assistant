
const nlRouter = require('./src/handlers/nlRouter');

async function test() {
  const inputs = [
    "Dodaj przypomnienie: jutro o 19:00 karmienie ryb",
    "przypomnij o 19:00 ryby",
    "Dodaj przypomnienie jutro ryby",
    "Dodaj przypomnienie: o 19:00"
  ];

  for (const text of inputs) {
    console.log(`\nInput: "${text}"`);
    const res = await nlRouter.route(text);
    console.log(JSON.stringify(res, null, 2));
  }
}

test().catch(console.error);
