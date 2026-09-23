(function configureApi() {
    const host = window.location.hostname;
    const isLocalDevelopment = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "";
    window.ARINO_API_URL = isLocalDevelopment
        ? "http://localhost:5254"
        : "https://api.arinoimoveis.com.br";
})();
