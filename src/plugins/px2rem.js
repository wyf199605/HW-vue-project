if (process.env.VUE_APP_PX2REM === 'enabled') {
    const designWidth = Number(process.env.VUE_APP_PX2REM_DESIGN_WIDTH),
        basePx = Number(process.env.VUE_APP_PX2REM_BASE_PX),
        scale = designWidth / basePx;

    const html = document.documentElement;
    let fontSize = html.offsetWidth / scale;

    html.style.fontSize = fontSize + 'px';

    window.onresize = () => {
        fontSize = html.offsetWidth / scale;
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