export const THEME_KEY = "ledgerly-theme";
export const ACCENT_KEY = "ledgerly-accent";

/**
 * Runs before first paint so the saved theme and accent apply without a flash.
 * A constant string: it never contains user input.
 */
export const THEME_SCRIPT = `(function(){try{var d=document.documentElement,m=localStorage.getItem("${THEME_KEY}")||"system",a=localStorage.getItem("${ACCENT_KEY}");if(m!=="light"&&m!=="dark"){m=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}d.setAttribute("data-theme",m);if(a)d.setAttribute("data-accent",a)}catch(e){}})()`;
