const bcrypt = require("bcryptjs");

const senha = process.env.TEST_PASSWORD;
const hash = process.env.TEST_HASH;

bcrypt.compare(senha, hash).then((resultado) => {
    console.log(resultado ? "HASH CORRETO" : "HASH INCORRETO");
});
