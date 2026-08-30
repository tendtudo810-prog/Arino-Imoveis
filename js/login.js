const form = document.getElementById("loginForm");
const mensagem = document.getElementById("mensagem");

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("email").value;
    const senha = document.getElementById("senha").value;

    try {
        const response = await fetch(
            "https://localhost:7168/api/Auth/login",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    email: email,
                    senha: senha
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            mensagem.textContent =
                data.mensagem || "E-mail ou senha incorretos.";

            return;
        }

        // Salva o JWT
        localStorage.setItem("token", data.token);

        // Salva algumas informações
        localStorage.setItem("email", data.email);
        localStorage.setItem("admin", data.admin);

        mensagem.textContent = "Login realizado!";

        // Vai para o painel
        window.location.href = "admin.html";

    } catch (error) {
        console.error(error);
        mensagem.textContent =
            "Não foi possível conectar à API.";
    }
});