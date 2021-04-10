import Cookies from 'js-cookie';

const VIEW_COUNT_COOKIE_NAME = "indexViewCount";
const VIEW_COUNT_ELEM_ID = VIEW_COUNT_COOKIE_NAME;


window.onload = function() {
    const onloads = document.getElementsByClassName("onload");
    for (const onloadEL of onloads) {
        onloadEL.className += " loaded";
    }
    updateAndDisplayCookieViewCount();
};


const updateAndDisplayCookieViewCount = function() {
    let viewCount;
    try {
        viewCount = parseInt(Cookies.get(VIEW_COUNT_COOKIE_NAME));
    } catch {
        // no-op
    }

    if (!viewCount) {
        viewCount = 1;
    } else {
        // Saturate at max safe integer.
        viewCount = Number.isSafeInteger(viewCount + 1) ? viewCount + 1 : viewCount;
    }
    Cookies.set(VIEW_COUNT_COOKIE_NAME, viewCount);

    document.getElementById(VIEW_COUNT_ELEM_ID).innerHTML = `You've visited this page ${viewCount.toString()} times`;
};

function dragElement(elmnt) {
    var pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    if (document.getElementById(elmnt.id + "header")) {
      // if present, the header is where you move the DIV from:
      document.getElementById(elmnt.id + "header").onmousedown = dragMouseDown;
    } else {
      // otherwise, move the DIV from anywhere inside the DIV:
      elmnt.onmousedown = dragMouseDown;
    }
  
    function dragMouseDown(e) {
      e = e || window.event;
      e.preventDefault();
      // get the mouse cursor position at startup:
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      // call a function whenever the cursor moves:
      document.onmousemove = elementDrag;

      // Delete the initial class.
      elmnt.classList.remove("start-faded-out");
    }
  
    function elementDrag(e) {
      e = e || window.event;
      e.preventDefault();
      // calculate the new cursor position:
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      // set the element's new position:
      elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
      elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
    }
  
    function closeDragElement() {
      // stop moving when mouse button is released:
      document.onmouseup = null;
      document.onmousemove = null;
    }
};

dragElement(document.getElementById("draggable-text-box"));