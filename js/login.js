(function () {
    "use strict";

    const API_URL = String(
        window.ARINO_API_URL ||
        "https://jogging-early-bat.abasthan.app"
    ).replace(/\/$/, "");

    const TOKEN_KEY = "arino_admin_token";

    const form = document.getElementById("loginForm");
    const emailInput = document.getElementById("email");
    const senhaInput = document.getElementById("senha");
    const togglePassword = document.getElementById("togglePassword");
    const mensagem = document.getElementById("mensagem");
    const loginButton = document.getElementById("loginButton");

    function setMessage(text, type) {
        if (!mensagem) return;
        mensagem.textContent = text || "";
        mensagem.dataset.type = type || "";
    }

    function setLoading(loading) {
        if (!loginButton) return;

        loginButton.disabled = loading;
        loginButton.setAttribute("aria-busy", String(loading));

        const label = loginButton.querySelector("span");

        if (label) {
            label.textContent = loading
                ? "Entrando..."
                : "Entrar no painel";
        }
    }

    async function readResponse(response) {
        const contentType =
            response.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
            try {
                return await response.json();
            } catch {
                return {};
            }
        }

        const text = await response.text();

        return text
            ? { mensagem: text }
            : {};
    }

    async function autenticar(email, senha) {
        const response = await fetch(
            `${API_URL}/api/auth/login`,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },

                body: JSON.stringify({
                    email,
                    senha
                })
            }
        );

        const data = await readResponse(response);

        if (!response.ok) {
            const message =
                data.erro ||
                data.mensagem ||
                "Não foi possível realizar o login.";

            throw new Error(message);
        }

        if (!data.token) {
            throw new Error(
                "A API não retornou um token de autenticação."
            );
        }

        return data;
    }

    async function testApi() {
        const response = await fetch(
            `${API_URL}/api/health`,
            {
                method: "GET",

                headers: {
                    "Accept": "application/json"
                },

                cache: "no-store"
            }
        );

        if (!response.ok) {
            throw new Error(
                `API indisponível (HTTP ${response.status}).`
            );
        }

        return readResponse(response);
    }

    function redirectToAdmin() {
        window.location.href = "admin.html";
    }

    if (togglePassword && senhaInput) {
        togglePassword.addEventListener(
            "click",
            function () {
                const showing =
                    senhaInput.type === "text";

                senhaInput.type =
                    showing
                        ? "password"
                        : "text";

                togglePassword.setAttribute(
                    "aria-label",
                    showing
                        ? "Mostrar senha"
                        : "Ocultar senha"
                );
            }
        );
    }

    if (form) {
        form.addEventListener(
            "submit",
            async function (event) {
                event.preventDefault();

                const email =
                    String(
                        emailInput?.value || ""
                    )
                    .trim()
                    .toLowerCase();

                const senha =
                    String(
                        senhaInput?.value || ""
                    );

                setMessage("", "");

                if (!email || !senha) {
                    setMessage(
                        "Informe e-mail e senha.",
                        "error"
                    );

                    return;
                }

                setLoading(true);

                try {
                    await testApi();

                    const data =
                        await autenticar(
                            email,
                            senha
                        );

                    sessionStorage.setItem(
                        TOKEN_KEY,
                        data.token
                    );

                    setMessage(
                        "Login realizado com sucesso.",
                        "success"
                    );

                    redirectToAdmin();

                } catch (error) {
                    console.error(
                        "Erro no login:",
                        error
                    );

                    let message =
                        error instanceof Error
                            ? error.message
                            : "Não foi possível realizar o login.";

                    if (
                        message.includes(
                            "Failed to fetch"
                        )
                    ) {
                        message =
                            "Não foi possível conectar à API. Verifique se o backend do Abasthan está online e se o domínio está liberado no CORS.";
                    }

                    setMessage(
                        message,
                        "error"
                    );

                } finally {
                    setLoading(false);
                }
            }
        );
    }

    /*
     * IMPORTANTE:
     * Nenhuma senha, hash, AUTH_SECRET ou outro segredo
     * fica neste arquivo.
     *
     * A autenticação acontece exclusivamente na API.
     */
})();