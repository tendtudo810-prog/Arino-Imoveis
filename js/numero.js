const btnWhatsapp = document.querySelector(".btnWhatsapp");

btnWhatsapp.addEventListener("click", (e) => {
    e.preventDefault();

    const numero = "5561996973773";
    const mensagem = encodeURIComponent(
        "Olá! Vi o site da Arino Imóveis e gostaria de saber mais sobre os imóveis disponíveis."
    );

    window.open(`https://wa.me/${numero}?text=${mensagem}`, "_blank");
});