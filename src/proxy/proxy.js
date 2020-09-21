/**
 * @typedef FetchParams
 * @property {string} method
 * @property {Object} params
 * @property {number} version
 * @property {"GET" | "POST"} type
 * @property {boolean} silent
 * @property {boolean} loading
 * @property {string} loadingMsg
 * @property {boolean} cancel 是否关闭上一个请求，默认是
 * @property {boolean} parse 是否解析参数
 * @property {string} callType
 * @property {string} [returnType]
 */

/**
 *
 * @param {string} message
 * @return {null | Object | Array}
 */
const formatData = (message) => {
    if (message) {
        const input = document.createElement("input");
        input.value = message.replace(/\\/g, '\\\\');
        let data;
        try {
            data = JSON.parse(input.value.replace(/'/g, '"'));
        } catch (e) {
            console.error('请求返回值解析出错：' + e);
            data = null;
        }
        return data;
    }
    return null;
};

class RequestError extends Error {}

export default class BaseProxy {
    constructor({rootURL, errorHandler, loadingHandler, validator}) {
        /**
         * @private
         * @type {SW.Rpc3_0.BaseProxy}
         */
        this.proxy = new SW.Rpc3_0.BaseProxy({
            rootURL: rootURL,
            ws: SW.wsRest3_0_Promise({type: 'GET', returnType: 'json', callType: 'json'})
        });

        /**
         * @private
         * @type {Map<string, Promise>}
         */
        this.promiseMap = new Map();
        this.errorHandler = (message) => {
            typeof errorHandler === "function" && errorHandler(message);
        };
        this.loadingHandler = (message) => {
            return typeof loadingHandler === "function" && loadingHandler(message);
        };
        this.validator = validator;
    }

    /**
     * @param {FetchParams} data
     * @return {Promise<{data: null | Object | Array, result: Object}>}
     */
    fetch({method, params, version, type = 'GET', returnType = 'json', loading = true, loadingMsg, cancel = true, parse = true, silent = false, callType = 'json'} = {}) {
        const close = loading ? this.loadingHandler(loadingMsg) : null;
        const proxy = this.proxy;
        proxy.options.ws.options.type = type;
        proxy.options.ws.options.callType = callType;

        let promise = proxy.invoke(method, version, params, returnType);
        let oldPromise = this.promiseMap.get(method);
        if (oldPromise) {
            cancel && proxy.options.ws.close(oldPromise);
        }
        this.promiseMap.set(method, promise);

        let abort = false;

        promise.xhr.addEventListener("abort", () => {
            abort = true;
        });

        return promise.then(res => {
            try {
                typeof this.validator === "function" && this.validator(res);
            } catch (e) {
                throw new RequestError(e);
            }
            if ('Result' in res) {
                if (res.Result === 'false' || !res.Result) {
                    throw new RequestError(res.ErrorMessage || '请求失败');
                }

                return {
                    result: res,
                    data: res.Data,
                };
            }

            if (!silent && res.resultValue < 0) {
                // res.resultTips && Message.info({message: res.resultTips});
                throw new RequestError(res.resultTips || '请求失败');
            }

            return {
                data: parse ? formatData(res?.message) : null,
                result: res,
            };
        }).catch((e) => {
            console.error(`Request failed: ${method}`);
            console.error(e);
            if (abort) {
                throw e;
            }
            if (e instanceof RequestError) {
                if (!silent) {
                    this.errorHandler(e.message || '请求失败');
                }
            } else {
                if (!silent) {
                    this.errorHandler('请求失败');
                }
            }
            throw e;
        }).finally(() => {
            typeof close === "function" && close();
            if (this.promiseMap.get(method) === promise) {
                this.promiseMap.delete(method);
            }
        });
    }
}
