document.addEventListener("DOMContentLoaded", function () {

    const menuToggle = document.getElementById("menuToggle");
    const mobileMenu = document.getElementById("mobileMenu");

    if (!menuToggle || !mobileMenu) {
        return;
    }

    menuToggle.addEventListener("click", function () {
        mobileMenu.classList.toggle("is-open");
    });

    const links = mobileMenu.querySelectorAll("a");

    links.forEach(function (link) {
        link.addEventListener("click", function () {
            mobileMenu.classList.remove("is-open");
        });
    });

});