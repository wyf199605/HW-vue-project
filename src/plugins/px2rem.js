if (process.env.VUE_APP_PX2REM === 'enabled') {
    let html = document.documentElement;
    let fontSize = html.offsetWidth / 120;
    html.style.fontSize = fontSize + 'px';

    window.onresize = () => {
        fontSize = html.offsetWidth / 120;
        html.style.fontSize = fontSize + 'px';
    };

    /**
     * @param {number} px
     * @return {number}
     */
    window.px2rem = (px) => {
        return Number((px / fontSize).toFixed(3));
    };

    /**
     * @param {number} rem
     * @return {number}
     */
    window.rem2px = (rem) => {
        return Number((rem * fontSize).toFixed(1));
    };
}