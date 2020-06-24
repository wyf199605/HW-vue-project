/**
 * @typedef HeartCheck
 * @property {number} interval
 * @property {string} resultType
 * @property {string} responseType
 */

export default class HwSocket {
    /**
     * @private
     * @type {HeartCheck}
     */
    static defaultHeartCheckOptions = {
        interval: 55000,
        resultType: '',
        responseType: '',
    };

    /**
     * @constructor
     * @param onError
     * @param onMessage
     * @param {string} url
     * @param {HeartCheck} [heartCheckOptions]
     */
    constructor({onError, onMessage, url}, heartCheckOptions) {
        if (!('WebSocket' in window)) {
            onError && onError('您的浏览器不支持websocket.');
            return ;
        }
        /**
         * @private
         * @type {string}
         */
        this.url = url;
        /**
         * @private
         * @type {Function}
         */
        this.onMessage = onMessage;
        /**
         * @private
         * @type {Function}
         */
        this.onError = onError;
        /**
         * @private
         * @type {number | null}
         */
        this.timer = null;

        /**
         * @private
         * @type {HeartCheck}
         */
        this.heartCheckOptions = Object.assign({}, HwSocket.defaultHeartCheckOptions, heartCheckOptions || {});

        /**
         * @private
         * @type {WebSocket | null}
         */
        this.socket = null;

        this.initWebSocket();
    }

    /**
     * 初始化websocket
     * @private
     */
    initWebSocket() {
        const socket = new WebSocket(this.url);
        const onMessage = this.onMessage;
        const heartCheckOptions = this.heartCheckOptions;
        this.socket = socket;

        socket.onopen = () => {
            this.heartCheckStart();
        };

        socket.onmessage = ({data}) => {
            this.heartCheckStart();
            try{
                // respType等于pong时为心跳检测返回结果，无需处理
                if (data === heartCheckOptions.resultType) {
                    return ;
                }

                let result = JSON.parse(data);
                onMessage && onMessage(result);
            }catch (e) {
                console.error(e);
            }
        };

        socket.onerror = () => {
            this.errorHandler();
        };
    }

    /**
     * 开始心跳检测
     * @private
     */
    heartCheckStart() {
        clearTimeout(this.timer);
        const heartCheckOptions = this.heartCheckOptions;
        this.timer = setTimeout(() => {
            this.sendMessage(heartCheckOptions.responseType);
        }, heartCheckOptions.interval);
    }

    /**
     * websocket连接出错
     * @private
     */
    errorHandler(){
        let onError = this.onError;
        onError && onError('websocket连接失败');
    }

    /**
     * @public
     * @param {string | Object} data
     * @return boolean
     */
    sendMessage(data) {
        let socket = this.socket;
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(typeof data === "string" ? data : JSON.stringify(data));
            return true;
        }
        return false;
    }

    destroy() {
        clearTimeout(this.timer);
        this.socket && this.socket.close();
        this.socket = null;
        this.onMessage = null;
        this.onError = null;
    }
}