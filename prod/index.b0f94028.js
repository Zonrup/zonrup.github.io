import{$f583774a8743ac918fcaa7ee884877af$init as e}from"./index.15cb867e.js";var t,n=(t=e())&&t.__esModule?t.default:t;e();window.onload=function(){const e=document.getElementsByClassName("onload");for(const t of e)t.className+=" loaded";o()};const o=function(){let e;try{e=parseInt(n.get("indexViewCount"))}catch{}e=e?Number.isSafeInteger(e+1)?e+1:e:1,n.set("indexViewCount",e),document.getElementById("indexViewCount").innerHTML=`You've visited this page ${e.toString()} times`};!function(e){var t=0,n=0,o=0,d=0;function u(t){(t=t||window.event).preventDefault(),o=t.clientX,d=t.clientY,document.onmouseup=c,document.onmousemove=i,e.classList.remove("start-faded-out")}function i(u){(u=u||window.event).preventDefault(),t=o-u.clientX,n=d-u.clientY,o=u.clientX,d=u.clientY,e.style.top=e.offsetTop-n+"px",e.style.left=e.offsetLeft-t+"px"}function c(){document.onmouseup=null,document.onmousemove=null}document.getElementById(e.id+"header")?document.getElementById(e.id+"header").onmousedown=u:e.onmousedown=u}(document.getElementById("draggable-text-box"));
//# sourceMappingURL=index.b0f94028.js.map