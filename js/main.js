window.onload = function() {
    const onloads = document.getElementsByClassName("onload");
    for (const onloadEL of onloads) {
        onloadEL.className += " loaded";
    }
}