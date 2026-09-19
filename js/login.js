const API_URL = "http://localhost:5254";

document.addEventListener("DOMContentLoaded", () => {

    const form = document.getElementById("loginForm");
    const emailInput = document.getElementById("email");
    const senhaInput = document.getElementById("senha");
    const mensagem = document.getElementById("mensagem");

    // Verifica se o HTML possui os elementos necessários
    if (!form) {
        console.error("ERRO: Não encontrei o elemento #loginForm.");
        return;
    }

    form.addEventListener("submit", async (event) => {

        // Impede o navegador de recarregar a página
        event.preventDefault();

        const email = emailInput.value.trim();
        const senha = senhaInput.value;

        if (!email || !senha) {
            mostrarMensagem("Preencha todos os campos.", "erro");
            return;
        }

        mostrarMensagem("Entrando...", "info");

        try {

            const resposta = await fetch(
                `${API_URL}/api/Auth/login`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    credentials: "include",
                    body: JSON.stringify({
                        email: email,
                        senha: senha
                    })
                }
            );

            const dados = await resposta.json().catch(() => ({}));

            // ========================================
            // ERRO
            // ========================================

            if (!resposta.ok) {

                mostrarMensagem(
                    dados.mensagem ||
                    `Erro ao fazer login. Código: ${resposta.status}`,
                    "erro"
                );

                return;
            }

            if (!dados.token) {
                console.error("Diagnóstico de autenticação: login respondeu sem JWT.");
                mostrarMensagem("A API autenticou, mas não enviou uma sessão válida.", "erro");
                return;
            }

            sessionStorage.setItem("adminToken", dados.token);

            // ========================================
            // LOGIN REALIZADO
            // ========================================

            mostrarMensagem(
                "Login realizado com sucesso!",
                "sucesso"
            );

            // ========================================
            // REDIRECIONAR
            // ========================================

            setTimeout(() => {
                window.location.href = "admin.html";
            }, 500);

        } catch (erro) {
            console.error("Diagnóstico de autenticação: falha no POST /api/Auth/login.", erro);

            mostrarMensagem(
                erro instanceof TypeError
                    ? `Não foi possível conectar à API em ${API_URL}. Inicie o backend e tente novamente.`
                    : "Não foi possível concluir o login. Tente novamente.",
                "erro"
            );
        }
    });


    // ========================================
    // MENSAGEM
    // ========================================

    function mostrarMensagem(texto, tipo) {

        if (!mensagem) {
            console.warn("Elemento #mensagem não encontrado.");
            return;
        }

        mensagem.textContent = texto;
        mensagem.className = `mensagem ${tipo}`;
    }

});
